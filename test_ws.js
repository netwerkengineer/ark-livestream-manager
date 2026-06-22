const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9999/qlcplusWS');

ws.on('open', function open() {
  console.log('Connected!');
  ws.send('QLC+API|getWidgetStatus|53');
  setTimeout(() => ws.close(), 3000);
});

ws.on('message', function incoming(data) {
  console.log('Received:', data.toString());
});

ws.on('error', function error(err) {
  console.log('Error:', err);
});
