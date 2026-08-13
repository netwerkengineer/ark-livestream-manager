const fs = require('fs');
let content = fs.readFileSync('src/app/api/qlc/stream/route.ts', 'utf8');

const importAuth = 'import { isAuthorized } from "@/lib/authHelper";\n';
if (!content.includes('isAuthorized')) {
  content = content.replace('import WebSocket from "ws";', importAuth + 'import WebSocket from "ws";');
  
  const authCheck = `  const authSession = await isAuthorized(req, undefined, "lights");
  if (!authSession) {
    return new Response("Unauthorized", { status: 401 });
  }

`;
  content = content.replace('const settings = getSettings();', authCheck + '  const settings = getSettings();');
  fs.writeFileSync('src/app/api/qlc/stream/route.ts', content);
}
