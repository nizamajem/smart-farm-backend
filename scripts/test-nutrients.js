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

test('main water liters, concentrate ml and pump seconds are independent units', () => {
  const service = new NutrientsService(null, null, null);
  const device = { nutrientRecipe: { version: 2, waterLiters: 1000, aMl: 10, bMl: 10 }, dosingPumps: { a: { seconds: 5, ml: 10 }, b: { seconds: 10, ml: 10 }, phUp: { seconds: 3, ml: 2 }, phDown: { seconds: 4, ml: 2 } }, haRelays: { relay1: 'switch.a', relay2: 'switch.b' } };
  const plan = service.plan(device, 1000);
  assert.equal(plan.aMl, 10); assert.equal(plan.bMl, 10);
  assert.equal(plan.aSeconds, 5); assert.equal(plan.bSeconds, 10);
  assert.equal(plan.ready, true);
  const smaller = service.plan(device, 100);
  assert.equal(smaller.aMl, 1); assert.equal(smaller.aSeconds, .5);
  assert.equal(smaller.bMl, 1); assert.equal(smaller.bSeconds, 1);
  const missing = service.plan({ ...device, dosingPumps: {} }, 1000);
  assert.equal(missing.aMl, 10); assert.equal(missing.aSeconds, null); assert.equal(missing.ready, false);
  const legacy = { ...device, nutrientRecipe: { liters: .1, aSeconds: 5, bSeconds: 5 } };
  assert.equal(service.status(legacy).recipe, null);
  assert.equal(service.status(legacy).legacyRecipe, true);
  assert.throws(() => service.plan(legacy, 100));
  assert.deepEqual(legacy.nutrientRecipe, { liters: .1, aSeconds: 5, bSeconds: 5 });
});

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
    await service.savePump(device.id, 'a', { seconds: 4, ml: 10 });
    await service.savePump(device.id, 'b', { seconds: 4, ml: 10 });
    await service.saveRecipe(device.id, { waterLiters: 10, aMl: 10, bMl: 10, crop: 'Melon', plantAgeDays: 30, targetTds: 1200, targetPh: 6 });
    const d = await repo.findOneByOrFail({ id: device.id });
    assert.equal(d.nutrientRecipe.crop, 'Melon');
    assert.equal(d.nutrientRecipe.targetTds, 1200);
    assert.equal(d.nutrientRecipe.plantAgeDays, 30);
    const plan = service.plan(d, 10);
    assert.equal(plan.aSeconds, 4); assert.equal(plan.bSeconds, 4);
    assert.equal(service.plan(d, 20).aSeconds, 8);
    assert.equal(service.plan(d, 1000).ready, false);
    assert.ok(service.plan(d, 1000).issues.some(issue => issue.includes('60')));
    const input = { liters: 10, newWater: true, requestId: 'mix_test_0001', calibrationKey: plan.calibrationKey };
    await assert.rejects(service.start(device.id, { ...input, calibrationKey: 'old' }, owner.id));
    const started = await service.start(device.id, input, owner.id);
    assert.equal(started.mix.status, 'running');
    assert.equal((await service.start(device.id, input, owner.id)).mix.requestId, input.requestId);
    await assert.rejects(service.start(device.id, { ...input, requestId: 'mix_test_0002' }, owner.id));
    await assert.rejects(service.saveRecipe(device.id, { waterLiters: 10, aMl: 20, bMl: 20 }));
    await assert.rejects(relays.saveMapping(device.id, { relay1: 'switch.a', relay2: 'switch.b' }));
    for (let i = 0; i < 150; i++) { if ((await repo.findOneByOrFail({ id: device.id })).lastMix.status !== 'running') break; await wait(100); }
    const completed = (await repo.findOneByOrFail({ id: device.id })).lastMix;
    assert.equal(completed.status, 'completed');
    const ons = calls.filter(c => c.on);
    assert.deepEqual(ons.map(c => c.id).sort(), ['switch.a', 'switch.b']);
    assert.ok(Math.abs(ons[0].at - ons[1].at) < 500, 'A and B must start together, not after the other completes');
    assert.deepEqual(completed.completedChannels.sort(), ['a', 'b']);
    assert.equal(completed.recipe.targetPh, 6);
    for (const on of ons) {
      const off = calls.find(c => c.id === on.id && !c.on && c.at >= on.at);
      assert.ok(off.at - on.at >= 3900, 'four seconds must not be clamped to the three-second test limit');
    }
    const before = calls.length;
    await service.start(device.id, input, owner.id);
    assert.equal(calls.length, before, 'retry completed request must not dose again');
    await service.savePump(device.id, 'a', { seconds: .5, ml: 10 });
    await service.savePump(device.id, 'b', { seconds: 1.2, ml: 10 });
    const unequalOffset = calls.length;
    const unequalPlan = service.plan(await repo.findOneByOrFail({ id: device.id }), 10);
    await service.start(device.id, {...input, requestId:'unequal_0001', calibrationKey:unequalPlan.calibrationKey}, owner.id);
    for (let i = 0; i < 60; i++) { if ((await repo.findOneByOrFail({ id: device.id })).lastMix.status !== 'running') break; await wait(50); }
    const unequalCalls = calls.slice(unequalOffset);
    const aOn = unequalCalls.find(c => c.id === 'switch.a' && c.on), bOn = unequalCalls.find(c => c.id === 'switch.b' && c.on);
    const aOff = unequalCalls.find(c => c.id === 'switch.a' && !c.on), bOff = unequalCalls.find(c => c.id === 'switch.b' && !c.on);
    assert.ok(Math.abs(aOn.at - bOn.at) < 300);
    assert.ok(aOff.at - aOn.at >= 450 && aOff.at - aOn.at < 1000);
    assert.ok(bOff.at - bOn.at >= 1150);
    assert.equal((await repo.findOneByOrFail({ id: device.id })).lastMix.status, 'completed');
    await service.savePump(device.id, 'a', { seconds: .5, ml: 10 });
    await service.savePump(device.id, 'b', { seconds: .5, ml: 10 });
    const next = { ...input, calibrationKey: service.plan(await repo.findOneByOrFail({ id: device.id }), 10).calibrationKey, requestId: 'mix_stop_0001' };
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
