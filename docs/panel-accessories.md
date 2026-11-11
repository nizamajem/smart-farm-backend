# Perlengkapan per panel

Setiap panel menyediakan satu Smart MCB (status ON/OFF, daya W, tegangan V,
arus A), dua Smart Plug, satu level sensor (status dan kedalaman), satu
Smart Valve, serta 1–32 soil sensor (kelembapan dan suhu).

MCB memakai pemetaan dan riwayat listrik yang sudah ada. Komponen tambahan
disimpan di `devices.accessories`, terpisah dari empat relay larutan.
Panel lama mendapat slot kosong secara otomatis pada tampilan.

Admin membuka **Pengaturan alat** pada panel di website, lalu **Pengaturan perlengkapan**.
Pilih entity Home Assistant untuk setiap parameter, ubah nama bila perlu,
tambahkan soil sensor, lalu simpan. Pengaturan tidak menyalakan perangkat.
Smart Plug dan Smart Valve pada integrasi ini memakai entity `switch`,
sesuai contoh perangkat. Level menerima `sensor` atau `binary_sensor`
untuk status dan `sensor` untuk kedalaman. Unit kedalaman mengikuti HA.
Soil sensor memakai dua entity `sensor` dan menampilkan unit dari HA.

Endpoint terautentikasi:

- `GET /api/devices/:id/accessories`: status langsung HA, tanpa cache buatan.
- `PATCH /api/devices/:id/accessories`: pengaturan admin, disimpan ke database.
- `POST /api/devices/:id/accessories/command`: `{key: "plug1" | "plug2" | "valve", action: "ON" | "OFF"}`.

Hak akses panel mengikuti kepemilikan panel. Entity kontrol tidak boleh
berbagi dengan MCB, relay larutan, atau kontrol panel lain. Saat melepas
entity yang masih ON, matikan perangkat dahulu. Perintah tidak diulang
otomatis dan status sukses hanya ditampilkan setelah HA mengonfirmasi.

Aplikasi membaca ulang setiap 10 detik saat kontrol terbuka, serta saat
pengguna menarik halaman untuk memperbarui. Data komponen tambahan saat
ini merupakan status langsung; belum disalin ke riwayat sensor panel.

Sebelum menggunakan versi ini di server, cadangkan database lalu jalankan
migration `AddPanelAccessories1794355200000` melalui proses deployment:
`npm run migration:run:prod`. Setelah itu perbarui backend dan frontend.
Migration belum dijalankan pada server produksi oleh perubahan ini.

Validasi lokal: `npm run build`,
`node --test scripts/test-panel-accessories.js scripts/test-outlet-electricity.js`,
`npx tsc --noEmit` pada frontend, serta tes Flutter kontrol panel.
