#!/usr/bin/env python3
import json
import os
import subprocess
import time
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def get_settings():
    candidates = [
        os.path.join(SCRIPT_DIR, "data", "settings.json"),
        "/app/data/settings.json",
        "/mnt/data/docker/ark-livestream-manager/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading settings: {e}")
    return {}

def get_ssh_user(host_ip):
    if host_ip == "192.168.2.100":
        return "beamer"
    elif host_ip == "192.168.2.101":
        return "admin"
    return "jeffreygo"

def get_ssh_key_args():
    candidates = [
        "/app/data/id_rsa",
        os.path.join(SCRIPT_DIR, "data", "id_rsa"),
        "/volume1/docker/ark-livestream-manager/data/id_rsa",
        "/app/data/id_ed25519",
        os.path.join(SCRIPT_DIR, "data", "id_ed25519"),
        "/volume1/docker/ark-livestream-manager/data/id_ed25519"
    ]
    for c in candidates:
        if os.path.exists(c):
            tmp_key = "/tmp/id_ssh_temp"
            try:
                import shutil
                shutil.copy2(c, tmp_key)
                os.chmod(tmp_key, 0o600)
                return ["-i", tmp_key]
            except Exception as e:
                print(f"Error preparing temporary SSH key: {e}")
    return []

def run_ssh_cmd(user, host_ip, remote_cmd, capture=False):
    ssh_key_args = get_ssh_key_args()
    cmd = ["ssh"] + ssh_key_args + ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", f"{user}@{host_ip}", remote_cmd]
    return subprocess.run(cmd, capture_output=capture, text=True)

def wait_for_ssh(user, host, max_attempts=60):
    print(f"Waiting for remote host {host} to become available via SSH as user {user}...")
    ssh_key_args = get_ssh_key_args()
    for i in range(1, max_attempts + 1):
        cmd = ["ssh"] + ssh_key_args + ["-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no", f"{user}@{host}", "echo 'online'"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"Host {host} is online!")
            return True
        print(f"Attempt {i}/{max_attempts}: Host {host} not reachable yet. Waiting 2s...")
        time.sleep(2)
    return False

def startup_single_plug(plug, settings):
    name = plug.get("name", plug.get("id"))
    plug_id = plug.get("id")
    host_ip = plug.get("hostIp")
    
    # Fallback to settings hosts if empty
    if not host_ip or host_ip == "":
        if plug_id == "plug_obs":
            host_ip = settings.get("obsHost")
        elif plug_id == "plug_beamer":
            host_ip = settings.get("freeShowHost")
            
    user = get_ssh_user(host_ip)
    
    print(f"=== Starting Plug: {name} (ID: {plug_id}) ===")
    
    # 1. Turn on plug
    print(f"[{name}] Turning ON via control_plug.py...")
    subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "on", plug_id])
    
    # 2. If host IP is associated, wait for SSH and launch apps
    if host_ip and host_ip != "":
        print(f"[{name}] Associated host IP found: {host_ip}")
        if wait_for_ssh(user, host_ip):
            print(f"[{name}] Waiting 5s for system resources to stabilize...")
            time.sleep(5)
            
            obs_host = settings.get("obsHost")
            freeshow_host = settings.get("freeShowHost")
            
            # Detect remote OS
            known_windows_hosts = ["192.168.2.100", "192.168.2.101"]
            if host_ip in known_windows_hosts:
                is_win = True
            else:
                res = run_ssh_cmd(user, host_ip, "cmd.exe /c echo windows", capture=True)
                is_win = "windows" in res.stdout.lower()
            
            # Case A: FreeShow Host (or home environment fallback)
            if host_ip == freeshow_host or host_ip == "192.168.2.20":
                print(f"[{name}] FreeShow host detected. Importing Sunday project...")
                subprocess.run(["python3", os.path.join(SCRIPT_DIR, "import_project.py")])
                
                if is_win:
                    print(f"[{name}] Launching FreeShow on Windows via schtasks...")
                    res = run_ssh_cmd(user, host_ip, "schtasks /run /tn StartFreeShow")
                    if res.returncode != 0:
                        print(f"[{name}] Scheduled task StartFreeShow not found or failed. Running fallback Start-Process...")
                        run_ssh_cmd(user, host_ip, "powershell -Command \"Start-Process FreeShow\"")
                else:
                    print(f"[{name}] Launching FreeShow on Mac...")
                    run_ssh_cmd(user, host_ip, "open -a FreeShow")
                
                # If OBS is on the same machine, launch it too
                if obs_host == host_ip or host_ip == "192.168.2.20":
                    if is_win:
                        print(f"[{name}] Launching OBS on Windows via schtasks...")
                        res = run_ssh_cmd(user, host_ip, "schtasks /run /tn StartOBS")
                        if res.returncode != 0:
                            print(f"[{name}] Scheduled task StartOBS not found or failed. Running fallback Start-Process...")
                            run_ssh_cmd(user, host_ip, "powershell -Command \"Start-Process -FilePath 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' -WorkingDirectory 'C:\\Program Files\\obs-studio\\bin\\64bit'\"")
                    else:
                        print(f"[{name}] Launching OBS on Mac...")
                        run_ssh_cmd(user, host_ip, "open -a OBS")
            
            # Case B: OBS Host only
            elif host_ip == obs_host:
                if is_win:
                    print(f"[{name}] Launching OBS on Windows via schtasks...")
                    res = run_ssh_cmd(user, host_ip, "schtasks /run /tn StartOBS")
                    if res.returncode != 0:
                        print(f"[{name}] Scheduled task StartOBS not found or failed. Running fallback Start-Process...")
                        run_ssh_cmd(user, host_ip, "powershell -Command \"Start-Process -FilePath 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' -WorkingDirectory 'C:\\Program Files\\obs-studio\\bin\\64bit'\"")
                else:
                    print(f"[{name}] Launching OBS on Mac...")
                    run_ssh_cmd(user, host_ip, "open -a OBS")
            
            else:
                # Custom host - just log and try standard apps if applicable
                print(f"[{name}] Host {host_ip} is online. No specific FreeShow/OBS role mapped, skipping app launch.")
                
            print(f"✅ [{name}] Startup sequence completed successfully.")
        else:
            print(f"❌ [{name}] Error: Host {host_ip} did not become online via SSH.")
            return False
    else:
        print(f"✅ [{name}] Plug turned ON (no host IP mapped).")
    
    return True

def main():
    settings = get_settings()
    plugs = settings.get("tuyaPlugs", [])
    user = settings.get("sshUser", "jeffreygo")
    
    plug_id = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    
    if not plugs:
        # Fall back to legacy singular plug setup (Home environment)
        print("Warning: No plugs in tuyaPlugs list. Falling back to legacy settings...")
        device_id = settings.get("tuyaDeviceId")
        device_ip = settings.get("tuyaDeviceIp")
        local_key = settings.get("tuyaLocalKey")
        
        if not device_id or not device_ip or not local_key:
            print("Error: No legacy plug configuration found.")
            sys.exit(1)
            
        legacy_plug = {
            "id": "legacy",
            "name": "Legacy Home Plug",
            "ip": device_ip,
            "deviceId": device_id,
            "localKey": local_key,
            "version": settings.get("tuyaVersion", 3.5),
            "hostIp": "192.168.2.20" # Home Mac Mini
        }
        success = startup_single_plug(legacy_plug, settings)
        sys.exit(0 if success else 1)
        
    if plug_id == "all":
        print(f"=== Starting all {len(plugs)} plugs ===")
        overall_success = True
        for plug in plugs:
            success = startup_single_plug(plug, settings)
            if not success:
                overall_success = False
        sys.exit(0 if overall_success else 1)
        
    # Find specific plug
    target_plug = next((p for p in plugs if p.get("id", "").lower() == plug_id), None)
    if not target_plug:
        target_plug = next((p for p in plugs if p.get("name", "").lower() == plug_id), None)
        
    if not target_plug:
        print(f"Error: Plug '{plug_id}' not found in settings.")
        sys.exit(1)
        
    success = startup_single_plug(target_plug, settings)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
