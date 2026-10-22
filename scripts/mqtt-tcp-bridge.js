// TCP LAN -> MQTT over WebSocket. Each connection keeps its own MQTT credentials.
// Usage: node scripts/mqtt-tcp-bridge.js [wss-url] [bind-ip] [port]
const net = require('node:net');
const { pipeline } = require('node:stream');
const WebSocket = require('ws');

const target = process.argv[2] || 'wss://green.ptms3.com/api/mqtt';
const host = process.argv[3] || '127.0.0.1';
const port = Number(process.argv[4] || 1884);
if (!['wss:', 'ws:'].includes(new URL(target).protocol) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Expected a ws(s) URL and port 1..65535');
}

const sockets = new Set();
const server = net.createServer((tcp) => {
  sockets.add(tcp);
  const peer = `${tcp.remoteAddress}:${tcp.remotePort}`;
  console.log(`CONNECT ${peer}`);
  tcp.setNoDelay(true);
  const ws = new WebSocket(target, 'mqtt', { handshakeTimeout: 10000 });
  const stream = WebSocket.createWebSocketStream(ws);
  // pipeline handles backpressure, early disconnects, and upstream errors.
  const failed = (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`${peer}: ${err.message}`);
    tcp.destroy();
    stream.destroy();
    if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
  };
  ws.on('error', failed);
  pipeline(tcp, stream, failed);
  pipeline(stream, tcp, failed);
  tcp.on('close', () => {
    sockets.delete(tcp);
    console.log(`DISCONNECT ${peer}`);
  });
});
server.on('error', (err) => {
  console.error(`Bridge: ${err.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`MQTT TCP ${host}:${port} -> ${target}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    for (const socket of sockets) socket.destroy();
  });
}
