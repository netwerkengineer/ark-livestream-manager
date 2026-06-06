#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess
import os
from urllib.parse import urlparse, parse_qs

class TuyaHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to log requests to standard output
        print(f"[HTTP] {self.address_string()} - {format%args}")

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query_params = parse_qs(parsed_url.query)
        
        # Get 'plug' parameter. Defaults to 'all'.
        plug_id = query_params.get('plug', ['all'])[0]

        if path == '/on':
            print(f"Received HTTP request: Turn ON for plug: {plug_id} (starting startup sequence in background)")
            subprocess.Popen(["python3", "/app/startup_pcs.py", plug_id])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Startup sequence started in background for plug '{plug_id}'".encode())
            
        elif path == '/off':
            print(f"Received HTTP request: Turn OFF for plug: {plug_id}")
            res = subprocess.run(["python3", "/app/control_plug.py", "off", plug_id], capture_output=True, text=True)
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: {res.stdout}".encode())
            
        elif path == '/shutdown':
            print(f"Received HTTP request: Shutdown sequence for plug: {plug_id}")
            # Run the shutdown sequence in the background so the HTTP response is sent immediately
            subprocess.Popen(["python3", "/app/shutdown_pcs.py", plug_id])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Shutdown sequence started in background for plug '{plug_id}'".encode())
            
        elif path == '/status':
            res = subprocess.run(["python3", "/app/control_plug.py", "status", plug_id], capture_output=True, text=True)
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(res.stdout.encode())
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

def run():
    server_address = ('0.0.0.0', 8088)
    httpd = HTTPServer(server_address, TuyaHandler)
    print("Starting Tuya Control HTTP Server on port 8088...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Stopping server...")

if __name__ == '__main__':
    run()
