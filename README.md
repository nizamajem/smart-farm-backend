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

## Rilis aplikasi Android (APK)

Admin mengunggah APK dari menu **Aplikasi** di web; versi terbaru otomatis muncul sebagai tombol
**Unduh aplikasi Android** di halaman login.

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/api/app-releases/latest` | – | `{ release: {version, notes, size, sha256, createdAt} \| null }` |
| GET | `/api/app-releases/latest/download` | – | Unduh APK terbaru (`SmartFarm-<versi>.apk`) |
| GET | `/api/app-releases/:id/download` | – | Unduh versi tertentu |
| GET | `/api/app-releases` | admin | Daftar versi + jumlah unduhan |
| POST | `/api/app-releases` | admin | `multipart/form-data`: `file` (.apk), `version`, `notes?` |
| DELETE | `/api/app-releases/:id` | admin | Hapus versi beserta berkasnya |

Berkas disimpan di `RELEASES_DIR` (default: folder `releases/` di samping database, jadi ikut volume data Docker).
Batas ukuran `MAX_APK_MB` (default 100 — sama dengan batas unggah Cloudflare paket gratis).

## MQTT (jalur data langsung dari perangkat)

Broker MQTT berjalan **di dalam backend** (Aedes). Bisa dinyalakan/dimatikan dari web admin → **Integrasi**,
dan boleh aktif bersamaan dengan Home Assistant. Setiap data sensor ditandai sumbernya (`source`: `mqtt`, `ha`, `http`).

### Koneksi

| Jalur | URL | Keterangan |
|---|---|---|
| TCP (LAN) | `mqtt://<ip-server>:1883` | Paling ringan untuk ESP32 di jaringan yang sama |
| WebSocket (internet) | `wss://<domain>/api/mqtt` | Lewat Cloudflare/Caddy, subprotocol `mqtt` |

**Kredensial per perangkat** (lihat web → perangkat → tab Pengaturan):

- Username: `device-<id>` (mis. `device-1`)
- Password: device key perangkat
- Client ID: bebas & unik, disarankan `smartfarm-<id>`

**Akun pemantau tim HW** (`MQTT_ADMIN_USERNAME` / `MQTT_ADMIN_PASSWORD`, tampil di halaman Integrasi):
boleh subscribe/publish semua topik — cocok untuk MQTT Explorer saat debugging.

### Topik

### Bridge laptop untuk firmware MQTT TCP

Bila ESP32 hanya mendukung TCP dan server hanya dapat dijangkau lewat WSS,
jalankan bridge pada laptop di WiFi yang sama:

```powershell
cd backend
npm run bridge:mqtt -- wss://green.ptms3.com/api/mqtt 192.168.1.71 1884
```

Ganti IP dengan IP LAN laptop. Pada ESP32 isi Broker Host dengan IP tersebut
tanpa `mqtt://`, dan port `1884`. Username/password tetap diteruskan ke broker
Smart Farm; bridge tidak menyimpan kredensial. Laptop dan proses bridge harus
tetap aktif. Bila koneksi ESP32 timeout, periksa izin firewall untuk Node pada
jaringan lokal. TCP pada LAN tidak memakai TLS; koneksi laptop ke server memakai WSS.

Bridge hanya meneruskan protokol, bukan mengubah format topik. Firmware ABmix
yang memakai `ABmix/relay/0/set` belum dapat menerima perintah JSON
`smartfarm/<id>/cmd` dari website tanpa adapter atau perubahan firmware.

### Format pesan Smart Farm

| Topik | Arah | Payload |
|---|---|---|
| `smartfarm/<id>/telemetry` | perangkat → server | `{"temperature":27.5,"humidity":70,"soilMoisture":55,"lightLux":12000}` (field boleh sebagian) |
| `smartfarm/<id>/status` | perangkat → server | `online` / `offline` (pakai sebagai Last Will) |
| `smartfarm/<id>/cmd` | server → perangkat | `{"id":42,"relay":1,"action":"ON","durationMs":3000}` |
| `smartfarm/<id>/cmd/ack` | perangkat → server | `{"id":42}` setelah perintah dijalankan |

Aturan: perangkat hanya boleh publish ke 3 topik miliknya & subscribe `smartfarm/<id>/cmd`.
Publish ke topik lain → koneksi diputus. Perintah dikirim QoS 1; perintah yang tertunda saat perangkat
offline dikirim begitu perangkat tersambung (maks. 30 detik, lalu kedaluwarsa). Relay `ON` selalu maks. 3000 ms
— firmware tetap wajib auto-OFF sendiri.

### Contoh ESP32 (Arduino + PubSubClient)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

const char* DEVICE_ID = "1";
const char* DEVICE_KEY = "<device key>";
WiFiClient net;
PubSubClient mqtt(net);

void onCommand(char* topic, byte* payload, unsigned int len) {
  // parse {"id":..,"relay":..,"action":"ON|OFF","durationMs":..}, jalankan relay (auto-OFF lokal!),
  // lalu konfirmasi:
  // mqtt.publish("smartfarm/1/cmd/ack", "{\"id\":42}");
}

void connectMqtt() {
  mqtt.setServer("192.168.2.212", 1883);
  mqtt.setCallback(onCommand);
  while (!mqtt.connected()) {
    if (mqtt.connect("smartfarm-1", "device-1", DEVICE_KEY,
                     "smartfarm/1/status", 1, false, "offline")) {   // Last Will
      mqtt.publish("smartfarm/1/status", "online");
      mqtt.subscribe("smartfarm/1/cmd", 1);
    } else delay(2000);
  }
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  // tiap 10 detik:
  // mqtt.publish("smartfarm/1/telemetry", "{\"temperature\":27.5,\"humidity\":70}");
}
```

Simulator siap pakai (contoh alur lengkap): `npm run simulate:mqtt -- <id> <deviceKey> mqtt://<ip-server>:1883`

Endpoint terkait: `GET /api/devices/:id/mqtt` (kredensial, pemilik/admin), `GET /api/integrations`,
`PUT /api/integrations/mqtt|home-assistant` `{enabled}` (admin).


### Panel nutrisi & pH

Buka perangkat → **Nutrisi & pH**. Satu panel menggabungkan satu modul sensor
kualitas air dan satu modul empat relay: Larutan A, Larutan B, pH Up, pH Down.
Saat menambah perangkat, pilih jenis panel Nutrisi & pH agar label relay tersebut
tersimpan. Label perangkat lama tidak diganti otomatis.

Field telemetri tambahan (angka atau null bila tidak tersedia):

| Field | Satuan |
|---|---|
| `ph` | pH, 0–14 |
| `orp` | mV (boleh negatif) |
| `conductivity` | µS/cm |
| `tds` | ppm |
| `salinity` | ppm |
| `specificGravity` | tanpa satuan |
| `conductivityFactor` | tanpa satuan |

`temperature` (°C) dan `humidity` (%) tetap memakai field yang sudah ada.
MQTT: kirim ke `smartfarm/<id>/telemetry`; HTTP: `POST /api/iot/readings`.
Pemetaan Home Assistant tersedia di tab Pengaturan; pastikan satuan entity
sesuai tabel (EC pada mS/cm perlu dikonversi menjadi µS/cm sebelum dikirim).
Migration AddWaterQuality dijalankan otomatis pada startup backend, menambahkan
kolom nullable tanpa mengubah data lama.

Tombol **Lihat contoh data** hanya menampilkan snapshot referensi TDS02/Dosing01,
bukan memasukkan angka contoh ke database. Nilai pH yang unknown tetap kosong.
Status fisik relay belum tersedia pada API dan tidak disimpulkan dari perintah.

Wizard kalibrasi mencatat dua pembacaan buffer pH dan menghitung debit pompa dari
volume / durasi uji manual. Catatan disimpan lokal per panel pada browser ini;
belum tersinkron ke server, belum diterapkan ke perangkat, dan tidak menjalankan
pompa. Kontrol perangkat tetap tersedia pada tab Kontrol menggunakan protokol
Smart Farm; firmware ABmix masih memerlukan adapter topik sebelum dapat dikontrol.

### Pemetaan relay Home Assistant

Admin: buka **Perangkat → Pengaturan → Modul relay dari Home Assistant**.
Pilih entity `switch.*` atau `light.*` untuk Relay 1 (Larutan A), 2 (Larutan B),
3 (pH Up), dan 4 (pH Down), lalu simpan. Satu entity tidak boleh dipakai oleh
lebih dari satu kanal/panel. Menyimpan tidak menjalankan relay. Kanal kosong
tetap memakai protokol MQTT/HTTP Smart Farm; kanal yang dipetakan memakai HA.

Status Nyala/Mati dibaca dari HA setiap 5 detik, termasuk ketika modul sensor
air tidak online. Status HA bukan bukti pengukuran fisik aliran pompa.
Di tab Kontrol, **Uji 3 detik** mengirim ON lalu OFF melalui action REST HA.
Server tidak mengulang ON; OFF dicoba hingga tiga kali jika gagal. Matikan
tetap tersedia saat HA dinonaktifkan atau status belum tersedia. Perintah HA
dicatat dalam riwayat dengan transport `ha`, dan tidak dikirim ulang lewat
MQTT atau diambil firmware HTTP. Kegagalan diberi status `failed`.

Timer OFF ini berada di server dan bergantung pada koneksi. Auto-OFF di
perangkat/otomasi HA tetap diperlukan agar pompa berhenti jika proses server
mati atau jaringan putus. Uji satu kanal HA per panel pada satu waktu;
pemetaan tidak dapat diubah selama uji aktif. Wizard kalibrasi tetap berupa
catatan lokal dan tidak menjalankan uji secara otomatis.

API: admin `GET /api/home-assistant/relay-entities` dan
`PUT /api/home-assistant/devices/:id/relays` (body `relay1` sampai `relay4`,
string kosong untuk menghapus). Pemilik/admin dapat membaca
`GET /api/home-assistant/devices/:id/relays` dan mengirim kontrol melalui
`POST /api/devices/:id/commands` yang sudah ada. Token HA hanya ada di backend.
Migration AddHaRelays berjalan pada startup. Tes dengan HA tiruan:
`npm run test:ha-relays` di folder backend.

Action HA mengikuti [REST API Home Assistant](https://developers.home-assistant.io/docs/api/rest/).
