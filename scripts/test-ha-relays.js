// All HA traffic is mocked. This test never connects to hardware.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { SensorReading } = require('../dist/devices/sensor-reading.entity');
const { RelayCommand } = require('../dist/devices/relay-command.entity');
const { DevicesService } = require('../dist/devices/devices.service');
const { HaRelayService } = require('../dist/home-assistant/ha-relay.service');

test('HA relay mapping and command routing (mocked HA, in-memory DB)', async (t) => {
  const originalFetch = global.fetch;
  const env = { HA_BASE_URL: process.env.HA_BASE_URL, HA_TOKEN: process.env.HA_TOKEN };
  process.env.HA_BASE_URL = 'http://ha-test.invalid';
  process.env.HA_TOKEN = 'test-only';
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize();
  await db.runMigrations();
  let enabled = true;
  let failOn = false;
  let failOff = false;
  let notifyOn;
  let holdState;
  const calls = [];
  const emitted = [];
  const states = new Map(['switch.dosing_1', 'switch.dosing_2', 'switch.dosing_3', 'light.dosing_4'].map((id) => [id, 'off']));
  const snapshot = (id) => ({ entity_id: id, state: states.get(id), attributes: { friendly_name: id }, last_updated: new Date().toISOString() });
  global.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const id = JSON.parse(init.body).entity_id;
      const on = path.endsWith('/turn_on');
      calls.push({ id, on });
      if ((on && failOn) || (!on && failOff)) return new Response('{}', { status: 503 });
      states.set(id, on ? 'on' : 'off');
      if (on) notifyOn?.();
      return new Response('[]');
    }
    if (path === '/api/states') return Response.json([...states.keys()].map(snapshot));
    const id = decodeURIComponent(path.replace('/api/states/', ''));
    if (holdState) await holdState;
    return states.has(id) ? Response.json(snapshot(id)) : new Response('{}', { status: 404 });
  };
  const relays = new HaRelayService(db.getRepository(Device), { getBool: async () => enabled });
  const service = new DevicesService(db.getRepository(Device), db.getRepository(SensorReading), db.getRepository(RelayCommand), { action: async () => {} }, { commandCreated: (c) => emitted.push(c) }, relays);
  const user = { sub: 1, role: 'admin' };
  const mapping = { relay1: 'switch.dosing_1', relay2: 'switch.dosing_2', relay3: 'switch.dosing_3', relay4: 'light.dosing_4' };
  try {
    const owner = await db.getRepository(User).save({ name: 'Test', email: 'relay@example.invalid', passwordHash: 'test', role: 'admin' });
    user.sub = owner.id;
    const device = await service.create(user, { name: 'Dosing', relayLabels: ['Old A', 'Old B', 'Old C', 'Old D'] });
    await t.test('save validates unique, existing entities; saving never actuates', async () => {
      await assert.rejects(relays.saveMapping(device.id, { ...mapping, relay2: mapping.relay1 }), /satu kanal/i);
      await assert.rejects(relays.saveMapping(device.id, { relay1: 'sensor.ph' }), /switch atau light/i);
      await assert.rejects(relays.saveMapping(device.id, { relay1: 'switch.missing' }), /tidak ditemukan/i);
      const saved = await relays.saveMapping(device.id, mapping);
      assert.deepEqual(saved.haRelays, mapping);
      assert.deepEqual(saved.relayLabels, ['Larutan A', 'Larutan B', 'pH Up', 'pH Down']);
      const second = await service.create(user, { name: 'Other' });
      await assert.rejects(relays.saveMapping(second.id, { relay1: mapping.relay1 }), /panel lain/i);
      assert.equal(calls.length, 0);
    });
    await t.test('owner access enforced before actuation', async () => {
      await assert.rejects(service.queueCommand({ sub: 999, role: 'user' }, device.id, { relay: 1, action: 'ON', durationMs: 500 }), /tidak ditemukan/i);
      assert.equal(calls.length, 0);
    });
    await t.test('HA pulse completes OFF; never emitted to MQTT or HTTP pull', async () => {
      const command = await service.queueCommand(user, device.id, { relay: 1, action: 'ON', durationMs: 500 });
      assert.equal(command.transport, 'ha');
      assert.equal(command.status, 'done');
      await assert.rejects(service.ackCommand(await service.getOwned(user, device.id), command.id), /tidak ditemukan/i);
      assert.equal(states.get(mapping.relay1), 'off');
      assert.deepEqual(calls.map((c) => c.on), [true, false]);
      assert.equal(emitted.length, 0);
      assert.deepEqual(await service.pullCommands(await service.getOwned(user, device.id)), []);
    });
    await t.test('ON error still sends OFF; failed commands retained', async () => {
      failOn = true;
      await assert.rejects(service.queueCommand(user, device.id, { relay: 1, action: 'ON', durationMs: 500 }));
      failOn = false;
      assert.equal(calls.at(-1).on, false);
      const history = await service.commandsFor(user, device.id);
      assert.ok(history.some((c) => c.transport === 'ha' && c.status === 'failed'));
    });
    await t.test('serial dosing, mapping lock, and immediate OFF cancellation', async () => {
      const started = new Promise((resolve) => { notifyOn = resolve; });
      const pulse = service.queueCommand(user, device.id, { relay: 1, action: 'ON', durationMs: 3000 });
      await started;
      notifyOn = undefined;
      await assert.rejects(service.queueCommand(user, device.id, { relay: 2, action: 'ON', durationMs: 500 }), /kanal dosing/i);
      await assert.rejects(relays.saveMapping(device.id, mapping), /uji relay/i);
      await service.queueCommand(user, device.id, { relay: 1, action: 'OFF' });
      await pulse;
      assert.equal(states.get(mapping.relay1), 'off');
    });
    await t.test('disabled integration blocks ON while OFF remains available', async () => {
      enabled = false;
      const before = calls.length;
      await assert.rejects(service.queueCommand(user, device.id, { relay: 1, action: 'ON', durationMs: 500 }), /dimatikan/i);
      assert.equal(calls.length, before);
      await service.queueCommand(user, device.id, { relay: 1, action: 'OFF' });
      assert.equal(calls.at(-1).on, false);
      enabled = true;
    });
    await t.test('OFF during preflight cancels pending ON before actuation', async () => {
      let release;
      holdState = new Promise((resolve) => { release = resolve; });
      const before = calls.length;
      const pulse = service.queueCommand(user, device.id, { relay: 1, action: 'ON', durationMs: 500 });
      while (!relays.active.has(mapping.relay1)) await new Promise((resolve) => setImmediate(resolve));
      await service.queueCommand(user, device.id, { relay: 1, action: 'OFF' });
      holdState = undefined;
      release();
      await pulse;
      assert.ok(calls.slice(before).every((call) => !call.on));
    });
    await t.test('OFF failures retry three times and are surfaced', async () => {
      const before = calls.length;
      failOff = true;
      await assert.rejects(service.queueCommand(user, device.id, { relay: 1, action: 'OFF' }));
      failOff = false;
      assert.equal(calls.length - before, 3);
    });
    await t.test('unmapped channels retain original device transport', async () => {
      await relays.saveMapping(device.id, { relay1: mapping.relay1 });
      const command = await service.queueCommand(user, device.id, { relay: 2, action: 'OFF' });
      assert.equal(command.transport, 'device');
      assert.equal(command.status, 'pending');
      assert.equal(emitted.length, 1);
      const pending = await service.pullCommands(await service.getOwned(user, device.id));
      assert.deepEqual(pending.map((c) => c.id), [command.id]);
    });
    await t.test('migration rollback preserves existing devices and commands', async () => {
      const count = (await db.query('SELECT count(*) AS total FROM relay_commands'))[0].total;
      await db.undoLastMigration();
      assert.ok((await db.query('SELECT name FROM devices WHERE id = ?', [device.id])).length);
      assert.ok((await db.query('SELECT id FROM relay_commands')).length);
      await db.runMigrations();
      assert.equal((await service.getOwned(user, device.id)).haRelays, null);
      assert.equal((await db.query('SELECT count(*) AS total FROM relay_commands'))[0].total, count);
      assert.ok((await db.query('SELECT transport FROM relay_commands')).every((c) => c.transport === 'device'));
    });
  } finally {
    await relays.onModuleDestroy();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await db.destroy();
  }
});
