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
from activity_log import log_activity

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
            log_activity("plug", f"Stekker '{plug_id}' aangezet (handmatig)")
            invalidate_cache(plug_id)
            subprocess.Popen(["python3", os.path.join(SCRIPT_DIR, "startup_pcs.py"), plug_id])
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Startup sequence started in background for plug '{plug_id}'".encode())
            
        elif path == '/off':
            print(f"Received HTTP request: Turn OFF for plug: {plug_id}")
            log_activity("plug", f"Stekker '{plug_id}' uitgezet (handmatig)")
            invalidate_cache(plug_id)
            res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", plug_id], capture_output=True, text=True)
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: {res.stdout}".encode())
            
        elif path == '/off_delayed':
            try:
                delay = float(query_params.get('delay', ['30'])[0])
            except ValueError:
                delay = 30.0
            # Clamped so a bad/missing param can't turn this into either an
            # instant cut (no time for Windows to actually finish writing
            # to disk) or an effectively-forgotten one that never fires.
            delay = max(5.0, min(delay, 120.0))
            print(f"Received HTTP request: Turn OFF plug '{plug_id}' after a {delay}s delay")

            def _delayed_off(plug_id, delay):
                time.sleep(delay)
                invalidate_cache(plug_id)
                subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", plug_id])
                print(f"[Delayed Off] Plug '{plug_id}' turned off after {delay}s delay.")
                log_activity("plug", f"Stekker '{plug_id}' uitgezet (na {delay:.0f}s vertraging, PC-afsluiting)")

            # Runs on this server's own clock, not the machine that's
            # shutting down - a Windows PC's own scheduled task can't
            # safely sleep through its own shutdown teardown (it can get
            # force-killed mid-wait), but this process isn't shutting down
            # at all, so the wait is reliable here. The PC just needs to
            # fire this request at the very start of its shutdown, while
            # its network stack is still up.
            threading.Thread(target=_delayed_off, args=(plug_id, delay), daemon=True).start()
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"OK: Plug '{plug_id}' will be turned off in {delay}s".encode())

        elif path == '/shutdown':
            print(f"Received HTTP request: Shutdown sequence for plug: {plug_id}")
            log_activity("plug", f"Afsluitsequentie gestart voor '{plug_id}'")
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
            
        elif path == '/sync':
            # keep_on defaults to '1' so any caller that doesn't pass it
            # (e.g. an older cached frontend build) keeps the old
            # never-shuts-down manual-button behavior.
            keep_on = query_params.get('keep_on', ['1'])[0] != '0'
            targets_param = query_params.get('targets', [''])[0].strip()
            print(f"Received HTTP request: Trigger FreeShow sync (keep_on={keep_on}, targets={targets_param or 'all'})")
            log_path = os.path.join(SCRIPT_DIR, "data", "sync_cleanup.log")
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            trigger_label = "MANUAL" if keep_on else "AUTO (UNATTENDED)"
            with open(log_path, 'a') as log_file:
                log_file.write(f"\n--- {trigger_label} SYNC TRIGGERED AT {datetime.datetime.now()} ---\n")

            # Start process in background, redirecting stdout/stderr to the log file.
            # --keep-on: someone actively at their machine (the manual sync
            # button) must never have the Beamer PC shut down on them. An
            # unattended auto-trigger (e.g. after scheduling a stream) omits
            # the flag so the PC powers back down afterward, same as the
            # nightly scheduled sync.
            # targets: restricts this run to specific target keys (comma-
            # separated) - used by the manual sync button's per-target
            # checkboxes so additional devices (almost always powered off)
            # are never touched unless someone explicitly selects them.
            sync_args = ["python3", os.path.join(SCRIPT_DIR, "sync_and_cleanup_freeshow.py")]
            if keep_on:
                sync_args.append("--keep-on")
            if targets_param:
                sync_args.append(f"--only-targets={targets_param}")
            log_file_handle = open(log_path, 'a')
            subprocess.Popen(
                sync_args,
                stdout=log_file_handle,
                stderr=subprocess.STDOUT
            )
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(f"OK: Sync started in background (keep_on={keep_on})".encode())
            
        elif path == '/import_project':
            print("Received HTTP request: Trigger manual project import")
            log_path = os.path.join(SCRIPT_DIR, "data", "import_project.log")
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, 'a') as log_file:
                log_file.write(f"\n--- MANUAL PROJECT IMPORT TRIGGERED (VIA HTTP) AT {datetime.datetime.now()} ---\n")

            log_file_handle = open(log_path, 'a')
            subprocess.Popen(
                ["python3", os.path.join(SCRIPT_DIR, "import_project.py")],
                stdout=log_file_handle,
                stderr=subprocess.STDOUT
            )
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b"OK: Project import started in background")

        elif path == '/delete_scriptures':
            print("Received HTTP request: Trigger manual scripture deletion & sync")
            log_path = os.path.join(SCRIPT_DIR, "data", "sync_cleanup.log")
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, 'a') as log_file:
                log_file.write(f"\n--- MANUAL SCRIPTURE DELETION TRIGGERED AT {datetime.datetime.now()} ---\n")
            
            log_file_handle = open(log_path, 'a')
            subprocess.Popen(
                ["python3", os.path.join(SCRIPT_DIR, "sync_and_cleanup_freeshow.py"), "--delete-all-scriptures", "--local-only"],
                stdout=log_file_handle,
                stderr=subprocess.STDOUT
            )
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b"OK: Scripture deletion started in background")
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

def set_companion_button_step(host, port, page, row, col, step):
    import urllib.request
    url = f"http://{host}:{port}/api/location/{page}/{row}/{col}/step"
    data = json.dumps({"step": step}).encode("utf-8")
    req = urllib.request.Request(
        url, 
        data=data, 
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=1.0) as r:
            pass
    except Exception:
        pass

def status_poller_worker():
    print("[STATUS POLLER] Background status poller thread started.")
    global status_cache
    
    candidates = [
        os.path.join(SCRIPT_DIR, "data", "settings.json"),
        "/app/data/settings.json",
        "/mnt/data/docker/ark-livestream-manager/data/settings.json"
    ]
    
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
                
                # Parse plug status and sync with Companion button steps
                try:
                    plugs_data = json.loads(res.stdout)
                    
                    settings_path = None
                    for c in candidates:
                        if os.path.exists(c):
                            settings_path = c
                            break
                    
                    if settings_path:
                        with open(settings_path, 'r', encoding='utf-8') as f:
                            settings = json.load(f)
                        
                        comp_host = settings.get("companionHost", "127.0.0.1")
                        comp_port = settings.get("companionPort", 8000)
                        
                        plug_button_mapping = {
                            "plug_obs": (1, 0, 3),      # Page 1, Row 0, Col 3
                            "plug_beamer": (1, 0, 4)    # Page 1, Row 0, Col 4
                        }
                        
                        for plug in plugs_data:
                            p_id = plug.get("id")
                            if p_id in plug_button_mapping:
                                page, row, col = plug_button_mapping[p_id]
                                is_on = plug.get("state") == "on"
                                is_online = plug.get("is_online", True)
                                if is_online:
                                    desired_step = 1 if is_on else 0
                                    set_companion_button_step(comp_host, comp_port, page, row, col, desired_step)
                except Exception as sync_err:
                    print(f"[STATUS POLLER] Sync error: {sync_err}", file=sys.stderr)
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
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(server_address, TuyaHandler)
    print("Starting Tuya Control HTTP Server on port 8088...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Stopping server...")

if __name__ == '__main__':
    run()
