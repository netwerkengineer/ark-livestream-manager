const fs = require('fs');
let content = fs.readFileSync('src/components/LightsControl.tsx', 'utf8');
content = content.replace(
  'if (ws) {\n        ws.close();\n      }\n      wsRef.current = null;',
  'if (es) {\n        es.close();\n      }\n      eventSourceRef.current = null;'
);
// Also need to check if there are other `ws.` in the cleanup block
content = content.replace(/if \(ws\) \{.*?ws\.close\(\);.*?\}/gs, 'if (es) { es.close(); }');
fs.writeFileSync('src/components/LightsControl.tsx', content);
