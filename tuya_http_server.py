#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess
import os

class TuyaHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to log requests to standard output
        print(f"[HTTP] {self.address_string()} - {format%args}")

    def do_GET(self):
        if self.path == '/on':
            print("Received HTTP request: Turn ON (starting startup sequence in background)")
            subprocess.Popen(["python3", "/app/startup_pcs.py"])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK: Startup sequence started in background")
            
        elif self.path == '/off':
            print("Received HTTP request: Turn OFF")
            res = subprocess.run(["python3", "/app/control_plug.py", "off"], capture_output=True, text=True)
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: {res.stdout}".encode())
            
        elif self.path == '/shutdown':
            print("Received HTTP request: Shutdown sequence")
            # Run the shutdown sequence in the background so the HTTP response is sent immediately
            subprocess.Popen(["python3", "/app/shutdown_pcs.py"])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK: Shutdown sequence started in background")
            
        elif self.path == '/status':
            res = subprocess.run(["python3", "/app/control_plug.py", "status"], capture_output=True, text=True)
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
