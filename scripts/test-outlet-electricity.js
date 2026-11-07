const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { SensorReading } = require('../dist/devices/sensor-reading.entity');
const { HomeAssistantService } = require('../dist/home-assistant/home-assistant.service');
const { HaRelayService } = require('../dist/home-assistant/ha-relay.service');

test('one outlet stores flow, total liters and three normalized MCB readings', async () => {
  const originalFetch = global.fetch;
  const env = {HA_BASE_URL:process.env.HA_BASE_URL,HA_TOKEN:process.env.HA_TOKEN};
  process.env.HA_BASE_URL='http://ha-test.invalid'; process.env.HA_TOKEN='test';
  const db = new DataSource({...databaseOptions(),database:':memory:'});
  await db.initialize(); await db.runMigrations();
  try {
    const devices = db.getRepository(Device), readings = db.getRepository(SensorReading);
    const owner = await db.getRepository(User).save({name:'Test',email:'outlet@invalid.test',passwordHash:'test',role:'user'});
    const panel = await devices.save({name:'Panel',ownerId:owner.id,apiKey:'outlet',relayLabels:[],haEntities:{flowOut:'sensor.rate',flowOutTotal:'sensor.total'}});
    const state = (entity_id,state,unit) => ({entity_id,state,attributes:{unit_of_measurement:unit},last_updated:new Date().toISOString()});
    let states = [state('sensor.rate','120','L/h'),state('sensor.total','1.25','m³'),state('sensor.power','0.12','kW'),state('sensor.voltage','230000','mV'),state('sensor.current','520','mA')];
    global.fetch = async () => Response.json(states);
    const relays = new HaRelayService(devices,{getBool:async()=>true});
    await relays.saveMcbSensors(panel.id,{power:'sensor.power',energy:'',voltage:'sensor.voltage',current:'sensor.current'});
    const ha = new HomeAssistantService(devices,readings,{getBool:async()=>true});
    await ha.syncDevice(await devices.findOneByOrFail({id:panel.id}));
    let row = await readings.findOne({where:{deviceId:panel.id},order:{id:'DESC'}});
    assert.equal(row.flowOut,2); assert.equal(row.flowOutTotal,1250); assert.equal(row.flowIn,null);
    assert.equal(row.mcbPower,120); assert.equal(row.mcbVoltage,230); assert.equal(row.mcbCurrent,.52);
    const live = await relays.mcbStatus(await devices.findOneByOrFail({id:panel.id}));
    assert.equal(live.voltage.value,row.mcbVoltage); assert.equal(live.current.value,row.mcbCurrent);
    states = [state('sensor.rate','0','L/min'),state('sensor.total','2000','L'),state('sensor.power','unavailable','W'),state('sensor.voltage','230','A'),state('sensor.current','-1','A')];
    await ha.syncDevice(await devices.findOneByOrFail({id:panel.id}));
    row = await readings.findOne({where:{deviceId:panel.id},order:{id:'DESC'}});
    assert.equal(row.flowOut,0); assert.equal(row.flowOutTotal,2000);
    assert.equal(row.mcbPower,null); assert.equal(row.mcbVoltage,null); assert.equal(row.mcbCurrent,null);
    await assert.rejects(relays.saveMcbSensors(panel.id,{power:'',energy:'',voltage:'sensor.voltage',current:''}));
    await devices.update(panel.id,{haEntities:null});
    states = [state('sensor.power','100','W'),state('sensor.voltage','220','V'),state('sensor.current','0.5','A')];
    assert.equal((await ha.syncDevice(await devices.findOneByOrFail({id:panel.id}))).inserted,1);
    row = await readings.findOne({where:{deviceId:panel.id},order:{id:'DESC'}});
    assert.equal(row.mcbVoltage,220); assert.equal(row.flowOutTotal,null);
  } finally {
    global.fetch = originalFetch;
    for (const [key,value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key]=value;
    await db.destroy();
  }
});
