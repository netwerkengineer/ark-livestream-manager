#!/usr/bin/env python3
import json
import os
import subprocess
import time

def get_settings():
    candidates = [
        "/mnt/data/docker/ark-livestream-manager/data/settings.json",
        "/app/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading settings: {e}")
    return {}

def is_home_environment():
    try:
        # Check if the smart plug is online
        res = subprocess.run(["python3", "/app/control_plug.py", "status"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and "Error" not in res.stdout:
            return True
    except Exception:
        pass
    return False

def wait_for_ssh(user, host, max_attempts=60):
    print(f"Waiting for remote host {host} to become available via SSH...")
    for i in range(1, max_attempts + 1):
        res = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", "-o", "PasswordAuthentication=no", f"{user}@{host}", "echo 'online'"],
            capture_output=True, text=True
        )
        if res.returncode == 0:
            print(f"Host {host} is online!")
            return True
        print(f"Attempt {i}/{max_attempts}: Host {host} not reachable yet. Waiting 2s...")
        time.sleep(2)
    return False

def startup_pcs():
    settings = get_settings()
    home = is_home_environment()
    user = settings.get("sshUser", "jeffreygo")
    
    if home:
        print("=== Home Environment Detected ===")
        # 1. Turn on plug
        print("Enabling smart plug power...")
        subprocess.run(["python3", "/app/control_plug.py", "on"])
        
        # 2. Wait for Mac Mini
        mac_host = "192.168.2.20"
        if wait_for_ssh(user, mac_host):
            print("Waiting 5s for macOS system resources to stabilize...")
            time.sleep(5)
            
            # 3. Import project
            print("Importing project...")
            subprocess.run(["python3", "/app/import_project.py"])
            
            # 4. Start apps
            print("Launching OBS and FreeShow on Mac Mini...")
            subprocess.run(["ssh", f"{user}@{mac_host}", "open -a OBS && open -a FreeShow"])
            print("✅ Success: Home startup sequence completed.")
        else:
            print("❌ Error: Mac Mini did not become online.")
    else:
        print("=== Church Environment Detected (No Smart Plugs) ===")
        obs_host = settings.get("obsHost")
        freeshow_host = settings.get("freeShowHost")
        
        print(f"OBS Host: {obs_host}")
        print(f"FreeShow Host: {freeshow_host}")
        
        # 1. Handle FreeShow PC Project Import & App Launch
        if freeshow_host and freeshow_host not in ["localhost", "127.0.0.1"]:
            # Check if FreeShow PC is online (wait up to 10 seconds just in case it was booted manually recently)
            if wait_for_ssh(user, freeshow_host, max_attempts=5):
                print("Importing Sunday project to FreeShow PC...")
                subprocess.run(["python3", "/app/import_project.py"])
                
                # Check if Windows or Mac to trigger start
                res = subprocess.run(["ssh", f"{user}@{freeshow_host}", "cmd.exe /c echo windows"], capture_output=True, text=True)
                is_win = "windows" in res.stdout.lower()
                
                if is_win:
                    print("Launching FreeShow on Windows via StartFreeShow Scheduled Task...")
                    subprocess.run(["ssh", f"{user}@{freeshow_host}", "schtasks /run /tn StartFreeShow || powershell -Command \"Start-Process FreeShow\""])
                else:
                    print("Launching FreeShow on Mac...")
                    subprocess.run(["ssh", f"{user}@{freeshow_host}", "open -a FreeShow"])
                    
                # If OBS is on the same machine, launch it too
                if obs_host == freeshow_host:
                    if is_win:
                        print("Launching OBS on Windows via StartOBS Scheduled Task...")
                        subprocess.run(["ssh", f"{user}@{obs_host}", "schtasks /run /tn StartOBS || powershell -Command \"Start-Process obs64\""])
                    else:
                        print("Launching OBS on Mac...")
                        subprocess.run(["ssh", f"{user}@{obs_host}", "open -a OBS"])
            else:
                print(f"⚠️ Warning: FreeShow PC ({freeshow_host}) is offline. Skipping import.")
                
        # 2. Handle OBS PC (only if it is a separate host)
        if obs_host and obs_host not in ["localhost", "127.0.0.1"] and obs_host != freeshow_host:
            if wait_for_ssh(user, obs_host, max_attempts=5):
                res = subprocess.run(["ssh", f"{user}@{obs_host}", "cmd.exe /c echo windows"], capture_output=True, text=True)
                if "windows" in res.stdout.lower():
                    print("Launching OBS on Windows via StartOBS Scheduled Task...")
                    subprocess.run(["ssh", f"{user}@{obs_host}", "schtasks /run /tn StartOBS || powershell -Command \"Start-Process obs64\""])
                else:
                    print("Launching OBS on Mac...")
                    subprocess.run(["ssh", f"{user}@{obs_host}", "open -a OBS"])
            else:
                print(f"⚠️ Warning: OBS PC ({obs_host}) is offline. Skipping launch.")
                
        print("✅ Success: Church startup sequence completed.")

if __name__ == "__main__":
    startup_pcs()
