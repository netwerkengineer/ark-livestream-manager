const fs = require('fs');
let content = fs.readFileSync('src/app/api/qlc/action/route.ts', 'utf8');
content = content.replace(
  'return new Promise((resolve) => {',
  'return new Promise<Response>((resolve) => {'
);
fs.writeFileSync('src/app/api/qlc/action/route.ts', content);
