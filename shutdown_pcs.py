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
                print(f"Error reading settings from {c}: {e}")
    return {}

def is_home_environment():
    try:
        # Check if the smart plug is online/responsive (Home environment)
        res = subprocess.run(["python3", "/app/control_plug.py", "status"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and "Error" not in res.stdout:
            return True
    except Exception:
        pass
    return False

def shutdown_pcs():
    settings = get_settings()
    home = is_home_environment()
    
    if home:
        print("=== Home Environment Detected ===")
        mac_host = "192.168.2.20"
        mac_user = settings.get("sshUser", "jeffreygo")
        
        print(f"1. Sending remote shutdown command to Mac Mini ({mac_host})...")
        subprocess.run(["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", f"{mac_user}@{mac_host}", "sudo /sbin/shutdown -h now"])
        
        print("2. Waiting 15 seconds for Mac Mini to shut down...")
        time.sleep(15)
        
        print("3. Turning off the smart plug power...")
        subprocess.run(["python3", "/app/control_plug.py", "off"])
        print("✅ Success: Home shutdown sequence completed.")
    else:
        print("=== Church Environment Detected (No Smart Plugs) ===")
        obs_host = settings.get("obsHost")
        freeshow_host = settings.get("freeShowHost")
        user = settings.get("sshUser", "jeffreygo")
        
        hosts_to_shutdown = []
        if obs_host and obs_host not in ["localhost", "127.0.0.1"]:
            hosts_to_shutdown.append(obs_host)
        if freeshow_host and freeshow_host not in ["localhost", "127.0.0.1"] and freeshow_host not in hosts_to_shutdown:
            hosts_to_shutdown.append(freeshow_host)
            
        for host in hosts_to_shutdown:
            print(f"Sending shutdown to remote host ({host})...")
            # Try Windows shutdown first, then fall back to Unix shutdown
            subprocess.run([
                "ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", 
                f"{user}@{host}", "shutdown /s /f /t 0 || sudo shutdown -h now"
            ])
            
        print("✅ Success: Church shutdown commands sent.")

if __name__ == "__main__":
    shutdown_pcs()
