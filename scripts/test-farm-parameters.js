const test = require('node:test');
const assert = require('node:assert/strict');
const {DataSource} = require('typeorm');
const {databaseOptions} = require('../dist/database.config');
const {Device} = require('../dist/devices/device.entity');
const {SensorReading} = require('../dist/devices/sensor-reading.entity');
const {User} = require('../dist/users/user.entity');
const {HomeAssistantService} = require('../dist/home-assistant/home-assistant.service');
const {PanelAccessoriesService} = require('../dist/devices/panel-accessories.service');
const {defaultAccessories} = require('../dist/devices/panel-accessories');

test('GH averages configured valid sensors and stores water temperature separately', async()=>{
  const originalFetch=global.fetch;
  const old={HA_BASE_URL:process.env.HA_BASE_URL,HA_TOKEN:process.env.HA_TOKEN};
  process.env.HA_BASE_URL='http://ha.invalid';process.env.HA_TOKEN='test';
  const db=new DataSource({...databaseOptions(),database:':memory:'});
  await db.initialize();await db.runMigrations();
  try {
    const owner=await db.getRepository(User).save({name:'Test',email:'averages@test.invalid',passwordHash:'unused',role:'user'});
    const devices=db.getRepository(Device), readings=db.getRepository(SensorReading);
    let device=await devices.save({name:'GH 1',ownerId:owner.id,apiKey:'average-test',relayLabels:[],haEntities:{temperature:'sensor.t1',temperature2:'sensor.t2',temperature3:'sensor.t3',humidity:'sensor.h1',humidity2:'sensor.h2',humidity3:'sensor.h3',waterTemperature:'sensor.water'}});
    let source={ 'sensor.t1':'24','sensor.t2':'30','sensor.t3':'36','sensor.h1':'40','sensor.h2':'60','sensor.h3':'80','sensor.water':'21'};
    global.fetch=async()=>Response.json(Object.entries(source).map(([entity_id,state])=>({entity_id,state,attributes:{},last_updated:new Date().toISOString()})));
    const service=new HomeAssistantService(devices,readings,{getBool:async()=>true});
    const latest=async()=>readings.findOne({where:{deviceId:device.id},order:{id:'DESC'}});
    await service.syncDevice(device);
    let row=await latest();assert.equal(row.temperature,30);assert.equal(row.humidity,60);assert.equal(row.waterTemperature,21);
    device=await service.setDeviceEntities(device.id,{temperature3:'',humidity3:''});
    await service.syncDevice(device);row=await latest();assert.equal(row.temperature,27);assert.equal(row.humidity,50);
    source['sensor.t1']='unavailable';source['sensor.h1']='unknown';
    await service.syncDevice(device);row=await latest();assert.equal(row.temperature,30);assert.equal(row.humidity,60);
    device=await service.setDeviceEntities(device.id,{temperature:'',humidity:'',temperature2:'sensor.t2',humidity2:'sensor.h2'});
    await service.syncDevice(device);row=await latest();assert.equal(row.temperature,30);assert.equal(row.humidity,60);
    device=await service.setDeviceEntities(device.id,{temperature:'sensor.t2',temperature3:'sensor.t1'});
    source['sensor.t1']='24';
    await service.syncDevice(device);row=await latest();assert.equal(row.temperature,27,'duplicate entities count once');
    source['sensor.t1']='unavailable';source['sensor.t2']='unknown';
    await service.syncDevice(device);row=await latest();assert.equal(row.temperature,null,'no valid sensors is unavailable');
  } finally {global.fetch=originalFetch;for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;await db.destroy();}
});

test('three tanks convert percent or calibrated distance; curtain uses its own relay',async()=>{
  const originalFetch=global.fetch;
  const old={HA_BASE_URL:process.env.HA_BASE_URL,HA_TOKEN:process.env.HA_TOKEN};
  process.env.HA_BASE_URL='http://ha.invalid';process.env.HA_TOKEN='test';
  const db=new DataSource({...databaseOptions(),database:':memory:'});
  await db.initialize();await db.runMigrations();
  try {
    const owner=await db.getRepository(User).save({name:'Test',email:'tanks@test.invalid',passwordHash:'unused',role:'user'});
    const devices=db.getRepository(Device);
    const device=await devices.save({name:'GH',ownerId:owner.id,apiKey:'tank-test',relayLabels:[]});
    const source=[['sensor.main','30','%'],['sensor.a','20','cm'],['sensor.b','100','%'],['switch.curtain','off','']].map(([entity_id,state,unit])=>({entity_id,state,attributes:{unit_of_measurement:unit}}));
    const commands=[];
    global.fetch=async(url,init)=>{
      if(init?.method==='POST'){const entity=JSON.parse(init.body).entity_id;commands.push(entity);source.find(s=>s.entity_id===entity).state=url.endsWith('turn_on')?'on':'off';return Response.json([]);}
      return Response.json(source);
    };
    const service=new PanelAccessoriesService(devices,{getBool:async()=>true});
    const config={...defaultAccessories(),curtain:{name:'Tirai GH',entity:'switch.curtain'},tanks:[{key:'main',entity:'sensor.main',mode:'percent'},{key:'a',entity:'sensor.a',mode:'calibrated',emptyValue:100,fullValue:20},{key:'b',entity:'sensor.b',mode:'percent'}]};
    await service.save(device,config);
    const saved=await devices.findOneByOrFail({id:device.id});
    let status=await service.status(saved);assert.deepEqual(status.tanks.map(t=>t.percent),[30,100,100]);
    source[1].state='76';status=await service.status(saved);assert.equal(status.tanks[1].percent,30);
    source[0].state='unavailable';source[1].state='5';source[2].attributes.unit_of_measurement='cm';
    status=await service.status(saved);assert.deepEqual(status.tanks.map(t=>t.percent),[null,100,null]);
    await service.command(saved,{key:'curtain',action:'ON'});assert.deepEqual(commands,['switch.curtain']);
    await assert.rejects(service.save(saved,{...config,tanks:config.tanks.map(t=>({...t,key:'main'}))}));
    await assert.rejects(service.save(saved,{...config,tanks:config.tanks.map(t=>t.key==='a'?{...t,fullValue:100}:t)}));
    const second=await devices.save({name:'Other GH',ownerId:owner.id,apiKey:'other-tank-test',relayLabels:[]});
    await assert.rejects(service.save(second,{...defaultAccessories(),plugs:[{name:'Wrong',entity:'switch.curtain'},{name:'Other'}]}));
  } finally {global.fetch=originalFetch;for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;await db.destroy();}
});
