# Smart Farm — Backend

API NestJS + SQLite untuk sistem Smart Farm (auth JWT, perangkat, data sensor, perintah relay, endpoint IoT ESP32).

- Frontend: https://github.com/nizamajem/smart-farm-frontend
- Mobile: https://github.com/nizamajem/smart-farm-mobile

## Menjalankan

```bash
npm install
cp .env.example .env   # ganti JWT_SECRET
npm run start:dev      # http://localhost:3001/api
npm run simulate       # opsional: simulasi ESP32
```

Akun demo (dibuat otomatis saat DB kosong):

| Role | Email | Password |
|---|---|---|
| admin | `admin@smartfarm.local` | `admin123` |
| user | `user@smartfarm.local` | `user123` |

Tidak ada pendaftaran publik — akun admin/user baru dibuat oleh admin.
Device key demo: `demo-greenhouse-key`.

## Endpoint utama

- `POST /api/auth/login`, `GET /api/auth/me`
- Admin: `GET|POST /api/users`, `DELETE /api/users/:id`
- `GET|POST /api/devices`, `GET|DELETE /api/devices/:id`
- `GET /api/devices/:id/readings`, `GET|POST /api/devices/:id/commands`
- ESP32 (header `x-device-key`): `POST /api/iot/readings`, `GET /api/iot/commands`, `POST /api/iot/commands/:id/ack`

Relay ON dibatasi maks. 3000 ms; perintah yang tidak diambil dalam 30 detik ditandai `expired`.

## Migrasi database

Skema dikelola TypeORM migration (bukan `synchronize`). Migration yang belum jalan dieksekusi otomatis saat app start.

```bash
# setelah mengubah *.entity.ts, buat migration baru lalu commit file-nya
npm run migration:generate -- src/migrations/NamaPerubahan
npm run migration:run        # jalankan (dev)
npm run migration:revert     # batalkan yang terakhir
npm run db:backup            # backup SQLite
```

## Produksi

- `Dockerfile` → image dengan PM2 (`pm2-runtime ecosystem.config.js`), health check `GET /api/health`
- Deploy lengkap satu perintah: lihat repo [smart-farm-deploy](https://github.com/nizamajem/smart-farm-deploy)
- Tanpa Docker: `npm ci && npm run build && npm run migration:run:prod && pm2 startOrRestart ecosystem.config.js`

## Home Assistant

Integrasi lewat REST API Home Assistant dengan long-lived access token (opsional).

1. Di HA: **Profil → Security → Long-lived access tokens → Create token**
2. Isi `.env`: `HA_BASE_URL=http://<ip-ha>:8123` dan `HA_TOKEN=<token>`, lalu restart backend
3. Login sebagai admin → buka perangkat → kartu **Home Assistant** → pilih entity sensor untuk suhu,
   kelembapan, tanah, cahaya → **Simpan pemetaan**

Setiap `HA_SYNC_INTERVAL_SEC` detik (default 300) state entity tersebut disimpan sebagai data sensor perangkat,
jadi dashboard, grafik, dan aplikasi mobile langsung menampilkannya. Nilai `unavailable`/`unknown` dilewati.

Endpoint (khusus admin):

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/home-assistant/health` | Status koneksi ke HA |
| GET | `/api/home-assistant/states?domain=sensor` | Daftar entity (opsional disaring domain) |
| GET | `/api/home-assistant/states/:entityId` | State satu entity |
| GET | `/api/home-assistant/sensors?ids=a,b` | Nilai beberapa sensor |
| GET | `/api/home-assistant/history/:entityId?start=&end=` | Riwayat dari HA |
| PUT | `/api/home-assistant/devices/:id` | Pemetaan `{temperature?, humidity?, soilMoisture?, lightLux?}` (string kosong = hapus) |
| POST | `/api/home-assistant/sync` | Sinkronisasi sekarang |
