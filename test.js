const WebSocket = require('ws');
function resetQlc() {
  const ws = new WebSocket('ws://127.0.0.1:9999/qlcplusWS');
  ws.on('open', () => {
    ws.send('QLC+API|stopAllFunctions');
    setTimeout(() => ws.close(), 100);
  });
}
resetQlc();
