#!/usr/bin/env python3
"""Serveert roll.html en geeft /api door aan de FreeShow REST-API (poort 5506), zodat de pagina geen CORS-problemen heeft.
Gebruik: server.py [poort] [freeshow-rest-poort]   -> http://localhost:8099/roll.html"""
import http.server, json, os, sys, urllib.request
POORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
FS = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else 5506}/"
HIER = os.path.dirname(os.path.abspath(__file__))

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=HIER, **k)
    def do_POST(self):
        if self.path != "/api": return self.send_error(404)
        data = self.rfile.read(int(self.headers.get("content-length", 0)))
        try:
            r = urllib.request.urlopen(urllib.request.Request(FS, data, {"content-type": "application/json"}), timeout=3); body = r.read()
        except Exception as e: body = json.dumps({"error": str(e)}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", POORT), H).serve_forever()
