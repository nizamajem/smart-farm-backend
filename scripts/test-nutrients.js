const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { RelayCommand } = require('../dist/devices/relay-command.entity');
const { HaRelayService } = require('../dist/home-assistant/ha-relay.service');
const { NutrientsService } = require('../dist/devices/nutrients.service');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('calibrated mixing runs exact A/B durations, rejects duplicates and can stop', async () => {
  const originalFetch = global.fetch;
  const env = { HA_BASE_URL: process.env.HA_BASE_URL, HA_TOKEN: process.env.HA_TOKEN };
  process.env.HA_BASE_URL = 'http://ha-test.invalid'; process.env.HA_TOKEN = 'test';
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize();
  const states = new Map([['switch.a', 'off'], ['switch.b', 'off']]);
  const calls = [];
  let failB = false;
  global.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const id = JSON.parse(init.body).entity_id;
      const on = path.endsWith('/turn_on');
      calls.push({ id, on, at: Date.now() });
      if (on && id === 'switch.b' && failB) return new Response('{}', { status: 503 });
      states.set(id, on ? 'on' : 'off'); return new Response('[]');
    }
    const snapshot = id => ({ entity_id: id, state: states.get(id), attributes: {} });
    return new Response(JSON.stringify(path === '/api/states' ? [...states.keys()].map(snapshot) : snapshot(decodeURIComponent(path.split('/').at(-1)))));
  };
  let service, relays;
  try {
    await db.runMigrations();
    const owner = await db.getRepository(User).save({ name: 'Mix', email: 'mix@example.invalid', passwordHash: 'test', role: 'user' });
    const repo = db.getRepository(Device), commands = db.getRepository(RelayCommand);
    const device = await repo.save({ name: 'Tank', ownerId: owner.id, apiKey: 'mix', relayLabels: ['A', 'B', 'Up', 'Down'], haRelays: { relay1: 'switch.a', relay2: 'switch.b' } });
    relays = new HaRelayService(repo, { getBool: async () => true });
    service = new NutrientsService(repo, commands, relays);
    await service.saveRecipe(device.id, { liters: 10, aSeconds: 4, bSeconds: 4 });
    const d = await repo.findOneByOrFail({ id: device.id });
    const plan = service.plan(d, 10);
    assert.equal(plan.aSeconds, 4); assert.equal(plan.bSeconds, 4);
    assert.equal(service.plan(d, 20).aSeconds, 8);
    assert.throws(() => service.plan(d, 1000));
    const input = { liters: 10, newWater: true, requestId: 'mix_test_0001', calibrationKey: plan.calibrationKey };
    await assert.rejects(service.start(device.id, { ...input, calibrationKey: 'old' }, owner.id));
    const started = await service.start(device.id, input, owner.id);
    assert.equal(started.mix.status, 'running');
    assert.equal((await service.start(device.id, input, owner.id)).mix.requestId, input.requestId);
    await assert.rejects(service.start(device.id, { ...input, requestId: 'mix_test_0002' }, owner.id));
    await assert.rejects(service.saveRecipe(device.id, { liters: 10, aSeconds: 5, bSeconds: 5 }));
    await assert.rejects(relays.saveMapping(device.id, { relay1: 'switch.a', relay2: 'switch.b' }));
    for (let i = 0; i < 150; i++) { if ((await repo.findOneByOrFail({ id: device.id })).lastMix.status !== 'running') break; await wait(100); }
    const completed = (await repo.findOneByOrFail({ id: device.id })).lastMix;
    assert.equal(completed.status, 'completed');
    const ons = calls.filter(c => c.on);
    assert.deepEqual(ons.map(c => c.id), ['switch.a', 'switch.b']);
    for (const on of ons) {
      const off = calls.find(c => c.id === on.id && !c.on && c.at >= on.at);
      assert.ok(off.at - on.at >= 3900, 'four seconds must not be clamped to the three-second test limit');
    }
    const before = calls.length;
    await service.start(device.id, input, owner.id);
    assert.equal(calls.length, before, 'retry completed request must not dose again');
    await service.saveRecipe(device.id, { liters: 10, aSeconds: .5, bSeconds: .5 });
    const next = { ...input, calibrationKey: '10:0.5:0.5', requestId: 'mix_stop_0001' };
    await service.start(device.id, next, owner.id);
    await service.stop(device.id);
    assert.equal((await repo.findOneByOrFail({ id: device.id })).lastMix.status, 'stopped');
    assert.ok([...states.values()].every(s => s === 'off'));
    failB = true;
    await service.start(device.id, { ...next, requestId: 'mix_fail_0001' }, owner.id);
    for (let i = 0; i < 50; i++) { if ((await repo.findOneByOrFail({ id: device.id })).lastMix.status !== 'running') break; await wait(50); }
    assert.equal((await repo.findOneByOrFail({ id: device.id })).lastMix.status, 'failed');
    assert.ok([...states.values()].every(s => s === 'off'));
    const savedCommands = await commands.find();
    assert.ok(savedCommands.some(c => c.durationMs === 4000 && c.status === 'done'));
    await service.stop(device.id);
    const beforeRestart = calls.filter(c => c.on).length;
    const restartMix = { ...completed, status: 'running', requestId: 'interrupted_0001' };
    await repo.update(device.id, { lastMix: restartMix });
    await service.onModuleInit();
    const recovered = await repo.findOneByOrFail({ id: device.id });
    assert.equal(recovered.lastMix.status, 'failed');
    assert.equal(calls.filter(c => c.on).length, beforeRestart, 'restart must never resume dosing');
  } finally {
    if (service) await service.onModuleDestroy();
    if (relays) await relays.onModuleDestroy();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await db.destroy();
  }
});
