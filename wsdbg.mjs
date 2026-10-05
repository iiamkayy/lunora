import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3000/ws');
ws.on('open', () => { console.log('OPEN'); ws.send(JSON.stringify({ type: 'ping' })); });
ws.on('message', (d) => console.log('MSG:', d.toString().slice(0, 80)));
ws.on('error', (e) => console.log('ERROR:', e.message));
ws.on('unexpected-response', (req, res) => console.log('UNEXPECTED-RESPONSE:', res.statusCode));
ws.on('close', (c) => console.log('CLOSED:', c));
