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
const { HomeAssistantService } = require('../dist/home-assistant/home-assistant.service');

test('persistent manual relay switches, shared ownership-filtered history and real water flow', async t => {
  const fetch = global.fetch;
  const env = { HA_BASE_URL: process.env.HA_BASE_URL, HA_TOKEN: process.env.HA_TOKEN };
  process.env.HA_BASE_URL = 'http://ha-test.invalid'; process.env.HA_TOKEN = 'test';
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize(); await db.runMigrations();
  const repo = db.getRepository(Device), readings = db.getRepository(SensorReading);
  const states = new Map(['switch.a','switch.b','switch.up','switch.down'].map(id => [id, 'off']));
  const calls = [];
  let enabled = true, failBOn = false;
  const mapping = { relay1: 'switch.a', relay2: 'switch.b', relay3: 'switch.up', relay4: 'switch.down' };
  global.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { const id = JSON.parse(init.body).entity_id; const on = path.endsWith('turn_on'); calls.push({ id, on }); if (on && id === 'switch.b' && failBOn) return Response.json({}, {status:503}); states.set(id, on ? 'on' : 'off'); return Response.json([]); }
    return Response.json([...states].map(([entity_id, state]) => ({entity_id, state, attributes: {}})));
  };
  const relays = new HaRelayService(repo, { getBool: async () => enabled });
  const service = new DevicesService(repo, readings, db.getRepository(RelayCommand), { action: async () => {} }, {}, relays);
  try {
    const owner = await db.getRepository(User).save({ name: 'Owner', email: 'owner@invalid.test', passwordHash: 'test', role: 'user' });
    const other = await db.getRepository(User).save({ name: 'Other', email: 'other@invalid.test', passwordHash: 'test', role: 'user' });
    const a = await repo.save({name:'Panel A', apiKey:'a',ownerId:owner.id,relayLabels:['A','B','Up','Down'],haRelays:mapping});
    const b = await repo.save({name:'Panel B', apiKey:'b',ownerId:owner.id,relayLabels:[]});
    const hidden = await repo.save({name:'Private', apiKey:'hidden',ownerId:other.id,relayLabels:[]});
    await t.test('panel metadata updates persist without altering sensor mappings and reject other owners', async () => {
      const user = { sub: owner.id, role: 'user' };
      const updated = await service.update(user, a.id, { name: 'Green House 1', location: 'Lombok Timur' });
      assert.equal(updated.name, 'Green House 1');
      assert.equal(updated.location, 'Lombok Timur');
      const stored = await repo.findOneByOrFail({ id: a.id });
      assert.deepEqual(stored.haRelays, mapping);
      await assert.rejects(service.update(user, hidden.id, { name: 'Changed', location: '' }));
      assert.equal((await repo.findOneByOrFail({ id: hidden.id })).name, 'Private');
    });
    await t.test('ON stays ON beyond the old 3-second pulse and only OFF stops it', async () => {
      const on = await relays.manualSwitch(a.id, 1, 'ON');
      assert.equal(on[0].state, 'on');
      assert.equal(on[1].state, 'on');
      await new Promise(resolve => setTimeout(resolve, 3100));
      assert.equal(states.get(mapping.relay1), 'on');
      await assert.rejects(relays.saveMapping(a.id, mapping), /Matikan relay/);
      await relays.manualSwitch(a.id, 1, 'OFF');
      assert.equal(states.get(mapping.relay1), 'off');
      assert.deepEqual(calls.map(c => c.on), [true, true, false, false]);
    });
    await t.test('manual A/B failure turns both OFF and never reports partial success', async () => {
      failBOn = true;
      await assert.rejects(relays.manualSwitch(a.id, 1, 'ON'));
      assert.equal(states.get('switch.a'), 'off');
      assert.equal(states.get('switch.b'), 'off');
      failBOn = false;
      await relays.manualSwitch(a.id, 2, 'ON');
      assert.equal(states.get('switch.a'), 'on');
      assert.equal(states.get('switch.b'), 'on');
      await relays.manualSwitch(a.id, 2, 'OFF');
      assert.equal(states.get('switch.a'), 'off');
      assert.equal(states.get('switch.b'), 'off');
    });
    await t.test('dosing and manual operations cannot race; OFF remains available', async () => {
      const token = relays.reserveMix(a.id);
      await assert.rejects(relays.manualSwitch(a.id, 2, 'ON'));
      await relays.manualSwitch(a.id, 1, 'OFF');
      assert.equal(relays.mixCancelled(a.id, token), true);
      relays.releaseMix(a.id, token);
      enabled = false;
      await assert.rejects(relays.manualSwitch(a.id, 2, 'ON'));
      await relays.manualSwitch(a.id, 2, 'OFF'); enabled = true;
      await assert.rejects(relays.manualSwitch(b.id, 1, 'ON'));
      await assert.rejects(relays.manualSwitch(a.id, 5, 'ON'));
    });
    await t.test('global history merges panels, preserves names, sorts globally and excludes other owners', async () => {
      for (const [i, d] of [a, hidden, b, a].entries()) await readings.save({deviceId:d.id,temperature:20+i,createdAt:new Date(Date.UTC(2026,10,3,1,i))});
      const user = {sub:owner.id,role:'user'};
      const first = await service.allReadingsFor(user, {limit:2});
      assert.deepEqual(first.map(r => r.deviceName), ['Panel B','Green House 1']);
      assert.ok(first.every(r => !('device' in r)), 'history never leaks API keys through device relations');
      const next = await service.allReadingsFor(user, {limit:2,offset:2});
      assert.deepEqual(next.map(r => r.deviceName), ['Green House 1']);
      assert.equal((await service.allReadingsFor({sub:owner.id,role:'admin'})).length, 4);
      await assert.rejects(service.allReadingsFor(user, {from:'2026-11-04',to:'2026-11-03'}));
    });
    await t.test('HA flow readings are normalized to liters/minute; volume counters stay unavailable', async () => {
      const ha = new HomeAssistantService(repo, readings, {});
      await ha.setDeviceEntities(a.id, {flowIn:'sensor.in',flowOut:'sensor.out'});
      global.fetch = async () => Response.json([
        {entity_id:'sensor.in',state:'120',attributes:{unit_of_measurement:'L/h'}},
        {entity_id:'sensor.out',state:'0.18',attributes:{unit_of_measurement:'m³/h'}},
      ]);
      await ha.sync();
      let row = await readings.findOne({where:{deviceId:a.id},order:{id:'DESC'}});
      assert.equal(row.flowIn,2); assert.equal(row.flowOut,3);
      global.fetch = async () => Response.json([
        {entity_id:'sensor.in',state:'2',attributes:{unit_of_measurement:'L/min'}},
        {entity_id:'sensor.out',state:'5000',attributes:{unit_of_measurement:'L'}},
      ]);
      await ha.sync(); row = await readings.findOne({where:{deviceId:a.id},order:{id:'DESC'}});
      assert.equal(row.flowIn,2); assert.equal(row.flowOut,null);
    });
    await t.test('refresh syncs one owned panel before returning latest data', async () => {
      const { HomeAssistantController } = require('../dist/home-assistant/home-assistant.controller');
      const ha = new HomeAssistantService(repo, readings, {getBool:async()=>true});
      const controller = new HomeAssistantController(ha, {}, relays, service);
      await ha.setDeviceEntities(a.id, {ph:'sensor.ph',flowIn:'',flowOut:''});
      await ha.setDeviceEntities(b.id, {ph:'sensor.ph'});
      let requests = 0;
      global.fetch = async () => { requests++; return Response.json([{entity_id:'sensor.ph',state:'6.7',attributes:{},last_updated:new Date().toISOString()}]); };
      const before = await readings.count({where:{deviceId:b.id}});
      const result = await controller.syncOwnedDevice({sub:owner.id,role:'user'},a.id);
      assert.equal(result.synced,true); assert.equal(result.device.latestReading.ph,6.7);
      assert.equal(await readings.count({where:{deviceId:b.id}}),before);
      const count = requests;
      await assert.rejects(controller.syncOwnedDevice({sub:other.id,role:'user'},a.id));
      assert.equal(requests,count);
      await assert.rejects(new HomeAssistantService(repo,readings,{getBool:async()=>false}).syncDevice(await repo.findOneByOrFail({id:a.id})),/dinonaktifkan/);
      global.fetch = async () => Response.json([{entity_id:'sensor.ph',state:'unavailable',attributes:{} }]);
      assert.equal((await controller.syncOwnedDevice({sub:owner.id,role:'user'},a.id)).synced,false);
    });
  } finally {
    await relays.onModuleDestroy(); await db.destroy(); global.fetch = fetch;
    for (const [key,value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
