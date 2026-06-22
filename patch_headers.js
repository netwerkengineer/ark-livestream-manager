const fs = require('fs');
let content = fs.readFileSync('src/app/api/qlc/stream/route.ts', 'utf8');
content = content.replace(
  '"Connection": "keep-alive",',
  '"Connection": "keep-alive",\n      "X-Accel-Buffering": "no",'
);
fs.writeFileSync('src/app/api/qlc/stream/route.ts', content);
