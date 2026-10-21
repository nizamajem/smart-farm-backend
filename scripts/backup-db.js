// Backup SQLite yang aman walau aplikasi sedang berjalan (memakai backup API SQLite).
// Pemakaian: node scripts/backup-db.js [jumlahBackupDisimpan=10]
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH ?? 'smartfarm.sqlite';
const keep = Number(process.argv[2] ?? 10);

if (!fs.existsSync(dbPath)) {
  console.log(`[backup] ${dbPath} belum ada, dilewati (deploy pertama).`);
  process.exit(0);
}

const dir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `smartfarm-${stamp}.sqlite`);

new Database(dbPath, { readonly: true, fileMustExist: true })
  .backup(target)
  .then(() => {
    console.log(`[backup] ${target}`);
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sqlite'))
      .sort()
      .slice(0, -keep);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  })
  .catch((e) => {
    console.error('[backup] gagal:', e.message);
    process.exit(1);
  });
