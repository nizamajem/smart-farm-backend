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

Akun demo (dibuat otomatis saat DB kosong): `admin@smartfarm.local` / `admin123`, device key `demo-greenhouse-key`.

## Endpoint utama

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET|POST /api/devices`, `GET|DELETE /api/devices/:id`
- `GET /api/devices/:id/readings`, `GET|POST /api/devices/:id/commands`
- ESP32 (header `x-device-key`): `POST /api/iot/readings`, `GET /api/iot/commands`, `POST /api/iot/commands/:id/ack`

Relay ON dibatasi maks. 3000 ms; perintah yang tidak diambil dalam 30 detik ditandai `expired`.
