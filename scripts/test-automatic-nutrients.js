const test=require('node:test');
const assert=require('node:assert/strict');
const {DataSource}=require('typeorm');
const {databaseOptions}=require('../dist/database.config');
const {Device}=require('../dist/devices/device.entity');
const {User}=require('../dist/users/user.entity');
const {SensorReading}=require('../dist/devices/sensor-reading.entity');
const {AutomaticNutrientsService}=require('../dist/devices/automatic-nutrients.service');
const {AutomaticNutrientsDto,plantAge}=require('../dist/devices/automatic-nutrients');
const {plainToInstance}=require('class-transformer');
const {validate}=require('class-validator');
const config={enabled:true,ppmEnabled:true,phEnabled:true,targetPpm:800,targetPh:6,ppmTolerance:20,phTolerance:.1,abDoseLiters:1,phDoseMl:1,settleSeconds:60,maxCycles:2};

test('automatic DTO and HST boundaries validate',async()=>{
 assert.equal((await validate(plainToInstance(AutomaticNutrientsDto,config))).length,0);
 for(const invalid of [{settleSeconds:0},{maxCycles:0},{phDoseMl:-1},{stages:[{fromDay:0,toDay:7,targetPpm:0,targetPh:6}]}]) assert.ok((await validate(plainToInstance(AutomaticNutrientsDto,{...config,...invalid}))).length);
 assert.equal(plantAge('2026-11-01',new Date('2026-11-07T15:59:59Z')),6);
 assert.equal(plantAge('2026-11-01',new Date('2026-11-07T16:00:00Z')),7);
});
test('automatic control handles dosing, fresh feedback, HST, stop, restart, faults and cycle limits',async()=>{
 const db=new DataSource({...databaseOptions(),database:':memory:'});await db.initialize();await db.runMigrations();
 const devices=db.getRepository(Device),readings=db.getRepository(SensorReading);
 const owner=await db.getRepository(User).save({name:'Test',email:'automatic@test.invalid',passwordHash:'unused',role:'user'});
 const d=await devices.save({name:'GH',apiKey:'auto-test',ownerId:owner.id,relayLabels:[]});
 const calls=[];
 const nutrients={
  plan:()=>({ready:true,issues:[],calibrationKey:'ab'}),phPlan:()=>({ready:true,seconds:1,issues:[],calibrationKey:'ph'}),
  start:async(id,dto,user,automatic)=>{assert.equal(automatic,true);calls.push(['ppm',dto]);await devices.update(id,{lastMix:{requestId:dto.requestId,status:'completed',liters:1,aSeconds:1,bSeconds:1,startedAt:new Date().toISOString(),finishedAt:new Date(Date.now()-61000).toISOString()}});},
  startPh:async(id,dto,user,automatic)=>{assert.equal(automatic,true);calls.push([dto.channel,dto]);await devices.update(id,{lastPhDose:{...dto,status:'completed',seconds:1,startedAt:new Date().toISOString(),finishedAt:new Date(Date.now()-61000).toISOString()}});},
  stop:async()=>{},stopPh:async()=>{},
 };
 const service=new AutomaticNutrientsService(devices,readings,nutrients);
 const latest=()=>devices.findOneByOrFail({id:d.id});
 const sample=async(tds,ph,age=0,source='http')=>readings.save({deviceId:d.id,tds,ph,source,createdAt:new Date(Date.now()-age)});
 try{
  await service.save(d.id,config);await sample(700,6);await service.tick();assert.equal(calls.length,1);assert.equal(calls[0][0],'ppm');
  await service.tick();assert.equal(calls.length,1,'cached reading cannot dose twice');
  await sample(700,6);await service.tick();assert.equal(calls.length,2);
  await sample(700,6);await service.tick();assert.equal((await latest()).automaticNutrients.enabled,false,'cycle limit disables');
  await service.save(d.id,config);await sample(800,5.5);await service.tick();assert.equal(calls.at(-1)[0],'phUp');
  await service.save(d.id,config);await sample(800,6.5);await service.tick();assert.equal(calls.at(-1)[0],'phDown');
  await service.save(d.id,config);await sample(810,6.05);const before=calls.length;await service.tick();assert.equal(calls.length,before);assert.match((await latest()).automaticState.message,/stabil/);
  await sample(900,6);await service.tick();assert.equal(calls.length,before);assert.match((await latest()).automaticState.message,/pengenceran/);
  await service.save(d.id,config);await sample(700,6,130000);await service.tick();assert.equal((await latest()).automaticNutrients.enabled,false,'stale reading pauses');
  await service.save(d.id,config);await sample(700,null);await service.tick();assert.equal((await latest()).automaticNutrients.enabled,false);
  const plantedOn=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  await service.save(d.id,{...config,plantedOn,stages:[{fromDay:0,toDay:7,targetPpm:600,targetPh:6}]});
  await sample(700,6);await service.tick();assert.equal(calls.length,before,'HST target 600 replaces base target 800');
  assert.equal(service.status(await latest()).hst,0);
  await assert.rejects(service.save(d.id,{...config,plantedOn,stages:[{fromDay:1,toDay:7,targetPpm:600,targetPh:6}]}));
  await assert.rejects(service.save(d.id,{...config,plantedOn,stages:[{fromDay:0,toDay:7,targetPpm:600,targetPh:6},{fromDay:7,toDay:14,targetPpm:800,targetPh:6}]}));
  await service.save(d.id,{...config,enabled:false});await sample(500,5);await service.tick();assert.equal(calls.length,before);
  const oldFetch=global.fetch,oldBase=process.env.HA_BASE_URL,oldToken=process.env.HA_TOKEN;
  process.env.HA_BASE_URL='http://ha.invalid';process.env.HA_TOKEN='test';
  try {
    await devices.update(d.id,{haEntities:{tds:'sensor.ppm',ph:'sensor.ph'}});
    await service.save(d.id,config);await sample(700,6,600000,'ha');
    let reported=new Date().toISOString();
    global.fetch=async()=>Response.json([{entity_id:'sensor.ppm',state:'700',last_reported:reported,last_updated:reported},{entity_id:'sensor.ph',state:'6',last_reported:reported,last_updated:reported}]);
    const count=calls.length;
    await service.tick();assert.equal(calls.length,count+1,'fresh physical HA report works even if cached DB row is old');
    await service.tick();assert.equal(calls.length,count+1,'identical physical report never repeats dose');
    reported=new Date(Date.now()-130000).toISOString();
    await service.tick();assert.equal((await latest()).automaticNutrients.enabled,false,'stale physical HA report pauses');
  } finally {global.fetch=oldFetch;oldBase===undefined?delete process.env.HA_BASE_URL:process.env.HA_BASE_URL=oldBase;oldToken===undefined?delete process.env.HA_TOKEN:process.env.HA_TOKEN=oldToken;}
  await sample(500,6);
  await service.save(d.id,config);nutrients.start=async()=>{throw new Error('failed');};await sample(500,6);await service.tick();assert.equal((await latest()).automaticNutrients.enabled,false);
  await service.save(d.id,config);await service.onModuleInit();assert.equal((await latest()).automaticNutrients.enabled,false,'restart requires explicit re-enable');service.onModuleDestroy();
 } finally {service.onModuleDestroy();await db.destroy();}
});

test('min-max ranges drive PPM hysteresis, pH boundaries, HST expiration and saved history',async()=>{
 const db=new DataSource({...databaseOptions(),database:':memory:'});await db.initialize();await db.runMigrations();
 const devices=db.getRepository(Device),readings=db.getRepository(SensorReading);
 const owner=await db.getRepository(User).save({name:'Test',email:'range@test.invalid',passwordHash:'unused',role:'user'});
 const d=await devices.save({name:'Range GH',apiKey:'range-test',ownerId:owner.id,relayLabels:[]});
 const calls=[];
 const nutrients={plan:()=>({ready:true,issues:[],calibrationKey:'ab'}),phPlan:()=>({ready:true,seconds:1,issues:[],calibrationKey:'ph'}),stop:async()=>{},stopPh:async()=>{},
 start:async(id,dto)=>{calls.push('ppm');await devices.update(id,{lastMix:{requestId:dto.requestId,status:'completed',liters:1,aSeconds:1,bSeconds:1,startedAt:new Date().toISOString(),finishedAt:new Date(Date.now()-61000).toISOString()}});},
 startPh:async(id,dto)=>{calls.push(dto.channel);await devices.update(id,{lastPhDose:{...dto,status:'completed',seconds:1,startedAt:new Date().toISOString(),finishedAt:new Date(Date.now()-61000).toISOString()}});}};
 const service=new AutomaticNutrientsService(devices,readings,nutrients);
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const c={...config,ppmMin:800,ppmMax:1000,phMin:5.8,phMax:6.5,plantedOn:today,fromDay:0,toDay:65,maxCycles:10};
 const sample=async(tds,ph)=>readings.save({deviceId:d.id,tds,ph,source:'http',createdAt:new Date()});
 try {
  await service.save(d.id,c);await sample(800,6);await service.tick();assert.equal(calls.length,0,'at minimum no new correction');
  await sample(799,6);await service.tick();assert.deepEqual(calls,['ppm']);
  await sample(900,6);await service.tick();assert.deepEqual(calls,['ppm','ppm'],'continues to upper limit after starting');
  await sample(1000,6);await service.tick();assert.equal(calls.length,2,'at maximum stops');
  await sample(900,6);await service.tick();assert.equal(calls.length,2,'does not restart inside range');
  await sample(900,5.8);await service.tick();assert.equal(calls.length,2,'exact pH min is in range');
  await sample(900,6.5);await service.tick();assert.equal(calls.length,2,'exact pH max is in range');
  await sample(900,5.7);await service.tick();assert.equal(calls.at(-1),'phUp');
  await sample(900,6.6);await service.tick();assert.equal(calls.at(-1),'phDown');
  await assert.rejects(service.save(d.id,{...c,ppmMin:1000,ppmMax:800}));
  await assert.rejects(service.save(d.id,{...c,phMin:7,phMax:5}));
  await assert.rejects(service.save(d.id,{...c,fromDay:65,toDay:1}));
  let saved=await devices.findOneByOrFail({id:d.id});assert.equal(saved.nutrientSettingsHistory.length,1);assert.equal(saved.nutrientSettingsHistory[0].config.ppmMin,800);
  // Expiration is checked even when there is no new sensor report.
  const oldDay=new Date(Date.now()+8*3600000-66*86400000).toISOString().slice(0,10);
  await devices.update(d.id,{automaticNutrients:{...c,plantedOn:oldDay}});
  await service.tick();saved=await devices.findOneByOrFail({id:d.id});assert.equal(saved.automaticNutrients.enabled,false);assert.match(saved.automaticState.message,/HST/);
 }finally{service.onModuleDestroy();await db.destroy();}
});
