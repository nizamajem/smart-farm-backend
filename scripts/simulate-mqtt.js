// Simulator perangkat via MQTT — contoh alur untuk firmware ESP32.
// Pemakaian: npm run simulate:mqtt -- <deviceId> <deviceKey> [url]
//   url: mqtt://192.168.2.212:1883 (LAN)  atau  wss://green.ptms3.com/api/mqtt (internet)
const mqtt = require('mqtt');

const deviceId = process.argv[2] ?? '1';
const key = process.argv[3] ?? 'demo-greenhouse-key';
const url = process.argv[4] ?? 'mqtt://localhost:1883';
const base = `smartfarm/${deviceId}`;

const client = mqtt.connect(url, {
  clientId: `smartfarm-${deviceId}-sim`,
  username: `device-${deviceId}`,
  password: key,
  // Last Will: broker mengumumkan offline bila koneksi putus mendadak
  will: { topic: `${base}/status`, payload: 'offline', qos: 1, retain: false },
});

let soil = 60;

client.on('connect', () => {
  console.log(`Tersambung ke ${url} sebagai device-${deviceId}`);
  client.publish(`${base}/status`, 'online', { qos: 1 });
  client.subscribe(`${base}/cmd`, { qos: 1 });
  sendTelemetry();
});

function sendTelemetry() {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  soil = Math.max(20, soil - Math.random());
  const data = {
    temperature: +(24 + 8 * sun + Math.random()).toFixed(1),
    humidity: +(85 - 25 * sun + Math.random() * 3).toFixed(1),
    soilMoisture: +soil.toFixed(1),
    lightLux: Math.round(30000 * sun + Math.random() * 300),
  };
  client.publish(`${base}/telemetry`, JSON.stringify(data), { qos: 1 });
  console.log(new Date().toLocaleTimeString(), 'telemetry', data);
}
setInterval(() => client.connected && sendTelemetry(), 10_000);

client.on('message', (topic, payload) => {
  const cmd = JSON.parse(payload.toString()); // { id, relay, action, durationMs }
  console.log(`>> Relay ${cmd.relay} ${cmd.action}${cmd.action === 'ON' ? ` (${cmd.durationMs} ms)` : ''}`);
  if (cmd.relay === 1 && cmd.action === 'ON') soil = Math.min(80, soil + 10); // pompa air menyiram
  client.publish(`${base}/cmd/ack`, JSON.stringify({ id: cmd.id }), { qos: 1 });
});

client.on('error', (e) => console.log('error:', e.message));
client.on('close', () => console.log('koneksi tertutup, mencoba lagi…'));
