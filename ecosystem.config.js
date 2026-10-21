// Konfigurasi PM2. Di Docker dijalankan lewat `pm2-runtime`;
// tanpa Docker: `npm run build && pm2 startOrRestart ecosystem.config.js`.
module.exports = {
  apps: [
    {
      name: 'smartfarm-api',
      script: 'dist/main.js',
      // SQLite: cukup satu proses agar tidak berebut kunci tulis
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
