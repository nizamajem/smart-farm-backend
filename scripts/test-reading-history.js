const test = require('node:test');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database.config');
const { Device } = require('../dist/devices/device.entity');
const { User } = require('../dist/users/user.entity');
const { SensorReading } = require('../dist/devices/sensor-reading.entity');
const { RelayCommand } = require('../dist/devices/relay-command.entity');
const { DevicesService } = require('../dist/devices/devices.service');

test('reading history: ownership, local-day boundaries, paging and legacy ordering', async () => {
  const db = new DataSource({ ...databaseOptions(), database: ':memory:' });
  await db.initialize();
  try {
    await db.runMigrations();
    const owner = await db.getRepository(User).save({ name: 'History', email: 'history@example.invalid', passwordHash: 'test-only', role: 'user' });
    const device = await db.getRepository(Device).save({ name: 'History tank', ownerId: owner.id, apiKey: 'history-test-only', relayLabels: ['A', 'B', 'Up', 'Down'] });
    const readings = db.getRepository(SensorReading);
    const from = '2026-10-28T00:00:00+08:00', to = '2026-10-29T00:00:00+08:00';
    const at = [new Date('2026-10-27T15:59:59Z'), new Date(from), new Date('2026-10-28T04:00:00Z'), new Date(to)];
    for (let i = 0; i < at.length; i++) await readings.save({ deviceId: device.id, createdAt: at[i], ph: 6 + i / 10, tds: 700 + i });
    const service = new DevicesService(db.getRepository(Device), readings, db.getRepository(RelayCommand), {}, {}, {});
    const user = { sub: owner.id, role: 'user' };
    const range = await service.readingsFor(user, device.id, 200, { from, to });
    assert.deepEqual(range.map(r => r.tds), [701, 702]);
    const first = await service.readingsFor(user, device.id, 1, { from, to });
    const second = await service.readingsFor(user, device.id, 1, { from, to, offset: 1 });
    assert.deepEqual(first.map(r => r.tds), [702]);
    assert.deepEqual(second.map(r => r.tds), [701]);
    const legacy = await service.readingsFor(user, device.id, 2);
    assert.deepEqual(legacy.map(r => r.tds), [702, 703]);
    await assert.rejects(service.readingsFor({ sub: owner.id + 1, role: 'user' }, device.id, 200, { from, to }), /tidak ditemukan/i);
    await assert.rejects(service.readingsFor(user, device.id, 200, { from: to, to: from }), /Tanggal akhir/);
  } finally {
    await db.destroy();
  }
});
