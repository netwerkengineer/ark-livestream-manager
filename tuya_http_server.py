#!/usr/bin/env python3
import subprocess
import os
import sys
import threading
import time
import datetime
import json
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Global cache and lock for plug status to prevent flooding and improve performance
status_cache = {}
cache_lock = threading.Lock()
CACHE_TTL = 4.0  # seconds

def invalidate_cache(plug_id):
    with cache_lock:
        # Clear specific plug
        keys_to_remove = [k for k in status_cache.keys() if k[1] == plug_id or plug_id == "all" or k[1] == "all"]
        for k in keys_to_remove:
            status_cache.pop(k, None)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def scheduler_worker():
    print("[SCHEDULER] Background scheduler thread started.")
    last_runs = {}  # schedule_id -> "YYYY-MM-DD HH:MM"
    
    candidates = [
        os.path.join(SCRIPT_DIR, "data", "settings.json"),
        "/app/data/settings.json",
        "/mnt/data/docker/ark-livestream-manager/data/settings.json"
    ]
    
    while True:
        try:
            settings_path = None
            for c in candidates:
                if os.path.exists(c):
                    settings_path = c
                    break
            
            if settings_path:
                with open(settings_path, 'r', encoding='utf-8') as f:
                    settings = json.load(f)
                
                schedules = settings.get("schedules", [])
                now = datetime.datetime.now()
                current_time_str = now.strftime("%H:%M")
                current_minute_str = now.strftime("%Y-%m-%d %H:%M")
                
                # Python weekday: 0 = Monday, ..., 6 = Sunday
                # UI weekday: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
                ui_day = (now.weekday() + 1) % 7
                
                for sched in schedules:
                    if not sched.get("enabled", True):
                        continue
                    
                    sched_id = sched.get("id")
                    sched_time = sched.get("time")
                    sched_days = sched.get("days", [])
                    sched_action = sched.get("action")
                    sched_plug = sched.get("plug", "all")
                    
                    if sched_time == current_time_str and ui_day in sched_days:
                        # Check if already run in this minute to prevent duplicate runs
                        if last_runs.get(sched_id) != current_minute_str:
                            last_runs[sched_id] = current_minute_str
                            print(f"[SCHEDULER] Triggering schedule '{sched.get('name')}' (ID: {sched_id}, Action: {sched_action}, Plug: {sched_plug})")
                            
                            # Run target script in background
                            if sched_action == "on":
                                subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "startup_pcs.py"), sched_plug])
                            elif sched_action == "shutdown":
                                subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "shutdown_pcs.py"), sched_plug])
                            elif sched_action == "off":
                                subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", sched_plug])
        except Exception as e:
            print(f"[SCHEDULER] Error in scheduler loop: {e}", file=sys.stderr)
        time.sleep(15)

class TuyaHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[HTTP] {self.address_string()} - {format%args}")

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query_params = parse_qs(parsed_url.query)
        
        # Get 'plug' parameter. Defaults to 'all'.
        plug_id = query_params.get('plug', ['all'])[0]

        if path == '/on':
            print(f"Received HTTP request: Turn ON for plug: {plug_id} (starting startup sequence in background)")
            invalidate_cache(plug_id)
            subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "startup_pcs.py"), plug_id])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Startup sequence started in background for plug '{plug_id}'".encode())
            
        elif path == '/off':
            print(f"Received HTTP request: Turn OFF for plug: {plug_id}")
            invalidate_cache(plug_id)
            res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", plug_id], capture_output=True, text=True)
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: {res.stdout}".encode())
            
        elif path == '/shutdown':
            print(f"Received HTTP request: Shutdown sequence for plug: {plug_id}")
            invalidate_cache(plug_id)
            # Run the shutdown sequence in the background so the HTTP response is sent immediately
            subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "shutdown_pcs.py"), plug_id])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Shutdown sequence started in background for plug '{plug_id}'".encode())
            
        elif path == '/status':
            cache_key = ("status", plug_id)
            now = time.time()
            cached_data = None
            
            with cache_lock:
                if cache_key in status_cache:
                    entry = status_cache[cache_key]
                    if now - entry["timestamp"] < CACHE_TTL:
                        cached_data = entry["data"]
            
            if cached_data is None:
                res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "status", plug_id], capture_output=True, text=True)
                cached_data = res.stdout
                if res.returncode == 0:
                    with cache_lock:
                        status_cache[cache_key] = {
                            "timestamp": time.time(),
                            "data": cached_data
                        }
            
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            try:
                self.wfile.write(cached_data.encode())
            except Exception as e:
                print(f"[HTTP] Error writing /status response: {e}")
            
        elif path == '/status_json':
            cache_key = ("status_json", plug_id)
            cached_data = None
            
            with cache_lock:
                if cache_key in status_cache:
                    cached_data = status_cache[cache_key]["data"]
            
            if cached_data is None:
                res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "status_json", plug_id], capture_output=True, text=True)
                cached_data = res.stdout
                if res.returncode == 0:
                    with cache_lock:
                        status_cache[cache_key] = {
                            "timestamp": time.time(),
                            "data": cached_data
                        }
            
            if cached_data is None:
                cached_data = "[]"
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                self.wfile.write(cached_data.encode())
            except Exception as e:
                print(f"[HTTP] Error writing /status_json response: {e}")
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

def status_poller_worker():
    print("[STATUS POLLER] Background status poller thread started.")
    global status_cache
    
    # Wait a moment for server initialization
    time.sleep(2)
    
    while True:
        try:
            # Query status_json for all plugs
            res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "status_json", "all"], capture_output=True, text=True)
            if res.returncode == 0 and res.stdout.strip():
                with cache_lock:
                    status_cache[("status_json", "all")] = {
                        "timestamp": time.time(),
                        "data": res.stdout
                    }
            else:
                print(f"[STATUS POLLER] Error querying status: returncode {res.returncode}, stderr: {res.stderr}")
        except Exception as e:
            print(f"[STATUS POLLER] Exception in status poller loop: {e}", file=sys.stderr)
        
        # Poll every 8 seconds
        time.sleep(8)

def run():
    # Start background scheduler thread
    sched_thread = threading.Thread(target=scheduler_worker, daemon=True)
    sched_thread.start()

    # Start background status poller thread
    poller_thread = threading.Thread(target=status_poller_worker, daemon=True)
    poller_thread.start()

    server_address = ('0.0.0.0', 8088)
    httpd = ThreadingHTTPServer(server_address, TuyaHandler)
    print("Starting Tuya Control HTTP Server on port 8088...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Stopping server...")

if __name__ == '__main__':
    run()
