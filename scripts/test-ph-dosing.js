// HA traffic and long-running timers are mocked; no hardware is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { RelayCommand } = require('../dist/devices/relay-command.entity');
const { NutrientsService } = require('../dist/devices/nutrients.service');
const { PumpCalibrationDto, PhPlanDto } = require('../dist/devices/nutrients.controller');
const { HaRelayService } = require('../dist/home-assistant/ha-relay.service');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('pH calibration accepts measured minutes converted to seconds and validates inputs', async () => {
  assert.deepEqual(await validate(plainToInstance(PumpCalibrationDto, { seconds: '3600', ml: '150' })), []);
  for (const seconds of [-1, 0, 86401]) assert.ok((await validate(plainToInstance(PumpCalibrationDto, { seconds, ml: 150 }))).length);
  for (const dto of [{ channel: 'a', ml: 10 }, { channel: 'phUp', ml: 0 }]) assert.ok((await validate(plainToInstance(PhPlanDto, dto))).length);
});

test('pH dosing plans, exact timing, interlocks, stop, errors and restart recovery', async t => {
  const originalFetch = global.fetch, originalTimer = global.setTimeout;
  const env = { HA_BASE_URL: process.env.HA_BASE_URL, HA_TOKEN: process.env.HA_TOKEN };
  process.env.HA_BASE_URL = 'http://ha-test.invalid'; process.env.HA_TOKEN = 'test';
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize(); await db.runMigrations();
  const repo = db.getRepository(Device), commands = db.getRepository(RelayCommand);
  const states = new Map(['switch.a', 'switch.b', 'switch.up', 'switch.down'].map(id => [id, 'off']));
  const calls = [], timers = [];
  let hold = false, failOn = false, failOff = false;
  global.setTimeout = (callback, ms, ...args) => {
    if (ms >= 500 && ms <= 3600000) { timers.push(ms); return originalTimer(callback, hold ? 60000 : 15, ...args); }
    return originalTimer(callback, ms, ...args);
  };
  const snapshot = id => ({ entity_id: id, state: states.get(id), attributes: {} });
  global.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const id = JSON.parse(init.body).entity_id, on = path.endsWith('/turn_on');
      calls.push({ id, on });
      if ((on && failOn) || (!on && failOff)) return new Response('{}', { status: 503 });
      states.set(id, on ? 'on' : 'off'); return Response.json([]);
    }
    return Response.json(path === '/api/states' ? [...states.keys()].map(snapshot) : snapshot(decodeURIComponent(path.split('/').at(-1))));
  };
  const relays = new HaRelayService(repo, { getBool: async () => true });
  const service = new NutrientsService(repo, commands, relays);
  let device, owner;
  const fresh = () => repo.findOneByOrFail({ id: device.id });
  const input = async (channel = 'phUp', requestId = `ph_${Date.now()}_${Math.random().toString(36).slice(2)}`) => {
    const plan = service.phPlan(await fresh(), channel, 10);
    return { channel, ml: 10, calibrationKey: plan.calibrationKey, requestId };
  };
  const done = async () => {
    for (let i = 0; i < 200; i++) { const d = await fresh(); if (d.lastPhDose.status !== 'running') return d.lastPhDose; await wait(5); }
    throw new Error('pH job did not finish');
  };
  try {
    owner = await db.getRepository(User).save({ name: 'PH', email: 'ph@example.invalid', passwordHash: 'test', role: 'user' });
    device = await repo.save({ name: 'Panel', ownerId: owner.id, apiKey: 'ph', relayLabels: ['A', 'B', 'Up', 'Down'], haRelays: { relay1: 'switch.a', relay2: 'switch.b', relay3: 'switch.up', relay4: 'switch.down' } });
    await service.savePump(device.id, 'phUp', { seconds: 3600, ml: 150 });
    await service.savePump(device.id, 'phDown', { seconds: 60, ml: 150 });
    await t.test('150 ml in 60 minutes gives 10 ml in 240 seconds; calculating never actuates', async () => {
      const d = await fresh(), plan = service.phPlan(d, 'phUp', 10);
      assert.equal(plan.seconds, 240); assert.equal(plan.ready, true);
      assert.equal(service.phPlan(d, 'phDown', 10).seconds, 4);
      assert.equal(service.phPlan({ ...d, dosingPumps: {} }, 'phUp', 10).ready, false);
      assert.equal(service.phPlan({ ...d, haRelays: {} }, 'phUp', 10).ready, false);
      assert.equal(service.phPlan(d, 'phUp', 1000000).ready, false);
      assert.throws(() => service.phPlan(d, 'phUp', 0));
      assert.throws(() => service.phPlan(d, 'invalid', 10));
      assert.equal(calls.length, 0);
    });
    await t.test('stale calibration is rejected before actuation', async () => {
      const dto = await input();
      await service.savePump(device.id, 'phUp', { seconds: 3600, ml: 200 });
      await assert.rejects(service.startPh(device.id, dto, owner.id), /Kalibrasi berubah/);
      assert.equal(calls.length, 0);
      await service.savePump(device.id, 'phUp', { seconds: 3600, ml: 150 });
    });
    await t.test('job uses 240000ms without the manual 3-second or AB 60-second clamp; retry never doubles dose', async () => {
      const dto = await input();
      await service.startPh(device.id, dto, owner.id);
      assert.equal((await done()).status, 'completed');
      assert.ok(timers.includes(240000));
      const command = await commands.findOneByOrFail({ deviceId: device.id, relay: 3 });
      assert.equal(command.durationMs, 240000); assert.equal(command.status, 'done');
      assert.deepEqual(calls.filter(c => c.on).map(c => c.id), ['switch.up']);
      const count = calls.length;
      await service.startPh(device.id, dto, owner.id);
      assert.equal(calls.length, count);
    });
    await t.test('while pH runs: opposite pump, AB mix, calibration and mapping changes are blocked; stop turns OFF', async () => {
      hold = true;
      const dto = await input('phDown');
      await service.startPh(device.id, dto, owner.id);
      for (let i = 0; i < 100 && states.get('switch.down') !== 'on'; i++) await wait(5);
      assert.equal(states.get('switch.down'), 'on');
      assert.equal((await service.startPh(device.id, dto, owner.id)).phDose.requestId, dto.requestId);
      await assert.rejects(service.startPh(device.id, await input('phUp'), owner.id));
      await assert.rejects(service.start(device.id, { requestId: 'ab_during_ph_1' }, owner.id));
      await assert.rejects(service.savePump(device.id, 'phUp', { seconds: 60, ml: 100 }));
      await assert.rejects(relays.saveMapping(device.id, device.haRelays));
      await service.stopPh(device.id);
      assert.equal((await fresh()).lastPhDose.status, 'stopped');
      assert.ok([...states.values()].every(value => value === 'off'));
      hold = false;
    });
    await t.test('HA ON errors still send OFF and surface failed status', async () => {
      failOn = true;
      await service.startPh(device.id, await input(), owner.id);
      const result = await done();
      assert.equal(result.status, 'failed'); assert.match(result.error, /Home Assistant/);
      assert.ok([...states.values()].every(value => value === 'off'));
      failOn = false;
    });
    await t.test('OFF failure is reported instead of pretending completion', async () => {
      failOff = true;
      await service.startPh(device.id, await input(), owner.id);
      const result = await done();
      assert.equal(result.status, 'failed'); assert.match(result.error, /OFF gagal/);
      failOff = false; states.set('switch.up', 'off');
    });
    await t.test('restart marks interrupted dose failed, switches pH OFF, never resumes', async () => {
      const last = (await fresh()).lastPhDose;
      await repo.update(device.id, { lastPhDose: { ...last, status: 'running' } });
      states.set('switch.up', 'on');
      const before = calls.filter(c => c.on).length;
      await service.onModuleInit();
      assert.equal((await fresh()).lastPhDose.status, 'failed');
      assert.equal(states.get('switch.up'), 'off');
      assert.equal(calls.filter(c => c.on).length, before);
    });
  } finally {
    failOn = false; failOff = false;
    await service.onModuleDestroy(); await relays.onModuleDestroy();
    global.fetch = originalFetch; global.setTimeout = originalTimer;
    for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await db.destroy();
  }
});
