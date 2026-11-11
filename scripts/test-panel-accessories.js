const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { PanelAccessoriesService } = require('../dist/devices/panel-accessories.service');
const { defaultAccessories, PanelAccessories, AccessoryCommand } = require('../dist/devices/panel-accessories');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

test('accessory mapping validates required slots and restricts physical controls', async () => {
  assert.equal((await validate(plainToInstance(PanelAccessories, defaultAccessories()))).length, 0);
  for (const config of [{...defaultAccessories(), soils:[]}, {...defaultAccessories(), plugs:[]}, {...defaultAccessories(), level:undefined}, {...defaultAccessories(), valve:{name:'Valve',entity:'sensor.other'}}]) {
    assert.ok((await validate(plainToInstance(PanelAccessories,config))).length > 0);
  }
  assert.ok((await validate(plainToInstance(AccessoryCommand,{key:'relay1',action:'ON'}))).length > 0);
});

test('migration, two plugs, valve, multiple soils and missing readings remain panel scoped', async () => {
  const originalFetch = global.fetch;
  const previous = {HA_BASE_URL:process.env.HA_BASE_URL, HA_TOKEN:process.env.HA_TOKEN};
  process.env.HA_BASE_URL='http://ha-test.invalid'; process.env.HA_TOKEN='test';
  const db = new DataSource({...databaseOptions(),database:':memory:'});
  await db.initialize(); await db.runMigrations();
  try {
    const owner = await db.getRepository(User).save({name:'Test',email:'accessories@test.invalid',passwordHash:'unused',role:'user'});
    const devices = db.getRepository(Device);
    const first = await devices.save({name:'Green House 1',ownerId:owner.id,apiKey:'a1',relayLabels:[]});
    const second = await devices.save({name:'Green House 2',ownerId:owner.id,apiKey:'a2',relayLabels:[]});
    let commands=[];
    let states = [
      ['switch.plug1','off',''], ['switch.plug2','on',''], ['switch.valve','off',''],
      ['binary_sensor.level','off',''], ['sensor.depth','0.10','m'],
      ['sensor.soil1','0','%'], ['sensor.soil2','unavailable','%'], ['sensor.soil_temp','25','°C'],
    ].map(([entity_id,state,unit])=>({entity_id,state,attributes:{unit_of_measurement:unit},last_updated:'2026-11-11T00:00:00Z'}));
    global.fetch = async (url,init) => {
      if(init?.method==='POST') {
        commands.push(JSON.parse(init.body).entity_id);
        states.find(s=>s.entity_id===commands.at(-1)).state=url.endsWith('turn_on')?'on':'off';
        return Response.json([]);
      }
      return Response.json(states);
    };
    let enabled=true;
    const service = new PanelAccessoriesService(devices,{getBool:async()=>enabled});
    assert.equal((await service.status(first)).plugs.length,2);
    const config = {...defaultAccessories(),plugs:[{name:'Pompa 1',entity:'switch.plug1'},{name:'Pompa 2',entity:'switch.plug2'}],valve:{name:'Valve',entity:'switch.valve'},level:{name:'Level',status:'binary_sensor.level',depth:'sensor.depth'},soils:[{name:'Bed 1',moisture:'sensor.soil1',temperature:'sensor.soil_temp'},{name:'Bed 2',moisture:'sensor.soil2'}]};
    await service.save(first,config);
    const saved=await devices.findOneByOrFail({id:first.id});
    assert.equal(saved.accessories.soils.length,2);
    let live=await service.status(saved);
    assert.equal(live.soils[0].moisture.value,0);
    assert.equal(live.soils[1].moisture.value,null);
    assert.equal(live.level.depth.value,0.1);
    assert.equal(live.level.depth.unit,'m');
    assert.equal((await service.status(second)).plugs[0].entityId,null);
    await assert.rejects(service.save(second,config));
    await assert.rejects(service.command(second,{key:'plug1',action:'ON'}));
    live=await service.command(saved,{key:'plug1',action:'ON'});
    assert.equal(live.plugs[0].state,'on');
    assert.deepEqual(commands,['switch.plug1']);
    enabled=false;
    await assert.rejects(service.command(saved,{key:'valve',action:'ON'}));
    assert.deepEqual(commands,['switch.plug1']);
    enabled=true;
    live=await service.command(saved,{key:'valve',action:'ON'});
    assert.equal(live.valve.state,'on');
    states.find(s=>s.entity_id==='switch.plug1').state='unavailable';
    await assert.rejects(service.command(saved,{key:'plug1',action:'OFF'}));
    assert.deepEqual(commands,['switch.plug1','switch.valve']);
  } finally {
    global.fetch=originalFetch;
    for (const [key,value] of Object.entries(previous)) value===undefined?delete process.env[key]:process.env[key]=value;
    await db.destroy();
  }
});
