const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { SensorReading } = require('../dist/devices/sensor-reading.entity');
const { RelayCommand } = require('../dist/devices/relay-command.entity');
const { DevicesService } = require('../dist/devices/devices.service');
const { NutrientsService } = require('../dist/devices/nutrients.service');
const { NutrientsController } = require('../dist/devices/nutrients.controller');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { HomeAssistantService } = require('../dist/home-assistant/home-assistant.service');
const { HaRelayService } = require('../dist/home-assistant/ha-relay.service');
const { requestLogger } = require('../dist/logs/request-logger.middleware');
const { logHub } = require('../dist/logs/log-hub');

test('real HTTP validation explains errors; sensor saves preserve pH and dosing configuration', async () => {
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize(); let app;
  try {
    await db.runMigrations();
    const repo = db.getRepository(Device), readings = db.getRepository(SensorReading), commands = db.getRepository(RelayCommand);
    const owner = await db.getRepository(User).save({ name: 'Settings test', email: 'settings@example.invalid', passwordHash: 'test', role: 'user' });
    const d = await repo.save({ name: 'Tank', ownerId: owner.id, apiKey: 'settings-test', relayLabels: ['A','B','Up','Down'], haEntities: { ph: 'sensor.my_ph', tds: 'sensor.old_tds' }, haRelays: { relay1: 'switch.a', relay2: 'switch.b' } });
    const relays = new HaRelayService(repo, { getBool: async () => false });
    const nutrients = new NutrientsService(repo, commands, relays);
    const devices = new DevicesService(repo, readings, commands, {}, {}, relays);
    const ha = new HomeAssistantService(repo, readings, {});
    await nutrients.saveRecipe(d.id, { liters: 10, aSeconds: 4, bSeconds: 4 });
    await ha.setDeviceEntities(d.id, { tds: 'sensor.new_tds' });
    let saved = await repo.findOneByOrFail({ id: d.id });
    assert.equal(saved.haEntities.ph, 'sensor.my_ph');
    assert.deepEqual(saved.nutrientRecipe, { liters: 10, aSeconds: 4, bSeconds: 4 });
    // A concurrent recipe write after a sensor form read must not be overwritten by sensor save.
    const stale = await repo.findOneByOrFail({ id: d.id });
    const staleRepo = Object.create(repo);
    staleRepo.findOne = async () => { await nutrients.saveRecipe(d.id, { liters: 10, aSeconds: 5, bSeconds: 5 }); return stale; };
    const staleHa = new HomeAssistantService(staleRepo, readings, {});
    await staleHa.setDeviceEntities(d.id, { temperature: 'sensor.water_temp' });
    saved = await repo.findOneByOrFail({ id: d.id });
    assert.equal(saved.nutrientRecipe.aSeconds, 5);
    assert.equal(saved.haEntities.ph, 'sensor.my_ph');
    await nutrients.saveRecipe(d.id, { liters: 10, aSeconds: 4, bSeconds: 4 });
    await Promise.all([ha.setDeviceEntities(d.id, { conductivity: 'sensor.ec' }), ha.setDeviceEntities(d.id, { orp: 'sensor.orp' })]);
    saved = await repo.findOneByOrFail({ id: d.id });
    assert.equal(saved.haEntities.ph, 'sensor.my_ph');
    assert.equal(saved.haEntities.conductivity, 'sensor.ec');
    assert.equal(saved.haEntities.orp, 'sensor.orp');
    class TestModule {}
    Module({ controllers: [NutrientsController], providers: [
      { provide: DevicesService, useValue: devices }, { provide: NutrientsService, useValue: nutrients },
      { provide: JwtService, useValue: { verifyAsync: async () => ({ sub: owner.id, role: 'user' }) } },
    ] })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api'); app.use(requestLogger);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (path, body) => fetch(`${base}/api/devices/${d.id}/nutrients/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only' }, body: JSON.stringify(body) });
    const valid = await request('plan', { liters: 10 });
    assert.equal(valid.status, 201);
    assert.equal((await valid.json()).aSeconds, 4);
    const localized = await request('plan', { liters: '10,0' });
    assert.equal(localized.status, 201);
    assert.equal((await localized.json()).bSeconds, 4);
    const large = await request('plan', { liters: 1000 });
    assert.equal(large.status, 201);
    const largePlan = await large.json();
    assert.equal(largePlan.aSeconds, 400); assert.equal(largePlan.ready, false);
    const bad = await request('plan', { liters: 'abc' });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).message.includes('Jumlah air harus berupa angka'));
    const entry = logHub.read('system').find(e => e.data?.reason?.includes('Jumlah air harus berupa angka'));
    assert.ok(entry, 'HTTP log must include the rejection reason');
    assert.equal(await commands.count(), 0, 'calculating never actuates a relay');
    assert.equal((await repo.findOneByOrFail({ id: d.id })).haEntities.ph, 'sensor.my_ph');
  } finally { if (app) await app.close(); await db.destroy(); }
});
