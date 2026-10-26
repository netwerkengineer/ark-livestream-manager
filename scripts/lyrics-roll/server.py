#!/usr/bin/env python3
"""Ontwikkelserver voor public/lyrics-roll.html zonder de hele app: serveert de pagina en beantwoordt /api/public/lyrics-roll zoals de app-route
(src/app/api/public/lyrics-roll/route.ts), door FreeShow's API (REST, standaard poort 5505) te vragen welke tekst er in beeld is.
Gebruik: server.py [poort] [freeshow-api-poort]   -> http://localhost:8099/lyrics-roll.html?h=1080   (in productie draait dit in de app zelf)"""
import http.server, json, os, sys, urllib.request
POORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
FS = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else 5505}/"
PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=PUBLIC, **k)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_GET(self):
        if self.path.split("?")[0] == "/api/public/lyrics-roll":
            try:
                r = urllib.request.urlopen(urllib.request.Request(FS, json.dumps({"action": "get_output_slide_text"}).encode(), {"content-type": "application/json"}), timeout=2)
                data = json.loads(r.read()).get("data"); body = json.dumps({"text": data if isinstance(data, str) else ""}).encode()
            except Exception: body = json.dumps({"text": "", "error": "FreeShow niet bereikbaar"}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body); return
        if self.path.split("?")[0] == "/roll.html": self.path = self.path.replace("/roll.html", "/lyrics-roll.html", 1)   # oude adres van de eerste proef
        super().do_GET()
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", POORT), H).serve_forever()
