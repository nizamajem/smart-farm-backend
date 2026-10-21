// Simulator ESP32: kirim data sensor & ambil perintah relay seperti firmware nantinya.
// Pemakaian: npm run simulate -- [deviceKey] [apiUrl]
const key = process.argv[2] ?? 'demo-greenhouse-key';
const api = process.argv[3] ?? 'http://localhost:3001/api';
const headers = { 'Content-Type': 'application/json', 'x-device-key': key };

let soil = 60;

async function sendReading() {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  soil = Math.max(20, soil - Math.random());
  const body = {
    temperature: +(24 + 8 * sun + Math.random()).toFixed(1),
    humidity: +(85 - 25 * sun + Math.random() * 3).toFixed(1),
    soilMoisture: +soil.toFixed(1),
    lightLux: Math.round(30000 * sun + Math.random() * 300),
  };
  const res = await fetch(`${api}/iot/readings`, { method: 'POST', headers, body: JSON.stringify(body) });
  console.log(new Date().toLocaleTimeString(), 'reading', res.status, body);
}

async function pollCommands() {
  const res = await fetch(`${api}/iot/commands`, { headers });
  if (!res.ok) return console.log('poll gagal', res.status);
  for (const cmd of await res.json()) {
    console.log(`>> Relay ${cmd.relay} ${cmd.action}${cmd.action === 'ON' ? ` (${cmd.durationMs} ms)` : ''}`);
    if (cmd.relay === 1 && cmd.action === 'ON') soil = Math.min(80, soil + 10); // pompa air menyiram
    await fetch(`${api}/iot/commands/${cmd.id}/ack`, { method: 'POST', headers });
  }
}

console.log(`Simulator ESP32 → ${api} (key: ${key}). Ctrl+C untuk berhenti.`);
const safe = (fn) => () => fn().catch((e) => console.log('error:', e.message));
safe(sendReading)();
setInterval(safe(sendReading), 10_000);
setInterval(safe(pollCommands), 2_000);
