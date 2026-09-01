#!/usr/bin/env python3
import json
import os
import subprocess
import time
import sys
from activity_log import log_activity

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
                print(f"Error reading settings from {c}: {e}")
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

def detect_os(user, host_ip):
    # Returns "windows", "macos", or "linux"
    # Quick check for known static hosts to avoid SSH roundtrip & timeouts
    known_hosts = {
        "192.168.2.100": "windows",
        "192.168.2.101": "windows",
        "192.168.2.20": "macos"
    }
    if host_ip in known_hosts:
        return known_hosts[host_ip]

    ssh_key_args = get_ssh_key_args()

    try:
        res = subprocess.run(
            ["ssh"] + ssh_key_args + [
                "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                f"{user}@{host_ip}", "cmd.exe /c echo windows"
            ], capture_output=True, text=True, timeout=3
        )
        if "windows" in res.stdout.lower():
            return "windows"
    except Exception:
        pass
        
    try:
        res = subprocess.run(
            ["ssh"] + ssh_key_args + [
                "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                f"{user}@{host_ip}", "uname"
            ], capture_output=True, text=True, timeout=3
        )
        if "darwin" in res.stdout.lower():
            return "macos"
    except Exception:
        pass
        
    return "linux"

def shutdown_single_plug_sequence(plug, settings):
    # This is a fallback/helper for a single plug sequence
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
    
    print(f"=== Starting Shutdown for Plug: {name} (ID: {plug_id}) ===")
    
    if host_ip and host_ip != "":
        print(f"[{name}] Detecting operating system for host ({host_ip}) as user {user}...")
        os_type = detect_os(user, host_ip)
        print(f"[{name}] Detected operating system: {os_type}")
        
        if os_type == "windows":
            cmd = "shutdown /s /f /t 0"
        elif os_type == "macos":
            cmd = "pmset sleepnow"
        else:
            cmd = "sudo /sbin/shutdown -h now"

        print(f"[{name}] Sending remote shutdown command ({cmd}) to host ({host_ip})...")
        ssh_key_args = get_ssh_key_args()
        subprocess.run(
            ["ssh"] + ssh_key_args + [
                "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                f"{user}@{host_ip}", cmd
            ]
        )
        print(f"[{name}] Waiting 35 seconds for host to shut down/sleep...")
        time.sleep(35)
        
    print(f"[{name}] Turning off plug power...")
    subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", plug_id])
    log_activity("plug", f"Stekker '{plug_id}' uitgezet (afsluitsequentie voltooid)")
    print(f"✅ [{name}] Shutdown sequence completed.")

def main():
    settings = get_settings()
    plugs = settings.get("tuyaPlugs", [])
    user = settings.get("sshUser", "jeffreygo")
    
    plug_id = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    
    if not plugs:
        # Fall back to legacy home Mac Mini setup
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
        shutdown_single_plug_sequence(legacy_plug, settings)
        sys.exit(0)

    # Determine target plugs to process
    targets = []
    if plug_id == "all":
        targets = plugs
    else:
        target_plug = next((p for p in plugs if p.get("id", "").lower() == plug_id), None)
        if not target_plug:
            target_plug = next((p for p in plugs if p.get("name", "").lower() == plug_id), None)
            
        if not target_plug:
            print(f"Error: Plug '{plug_id}' not found in settings.")
            sys.exit(1)
        targets = [target_plug]
        
    print(f"=== Triggering shutdown for {len(targets)} target plug(s) ===")
    
    # 1. Trigger SSH shutdown for all target hosts in parallel (non-blocking Popen)
    running_ssh_processes = []
    hosts_shutting_down = False
    
    for plug in targets:
        host_ip = plug.get("hostIp")
        p_id = plug.get("id")
        name = plug.get("name", plug.get("id"))
        
        # Fallback to settings hosts if empty
        if not host_ip or host_ip == "":
            if p_id == "plug_obs":
                host_ip = settings.get("obsHost")
            elif p_id == "plug_beamer":
                host_ip = settings.get("freeShowHost")
                
        user = get_ssh_user(host_ip)
        
        if host_ip and host_ip != "":
            hosts_shutting_down = True
            print(f"[{name}] Detecting operating system for host ({host_ip}) as user {user}...")
            os_type = detect_os(user, host_ip)
            print(f"[{name}] Detected operating system: {os_type}")
            
            if os_type == "windows":
                cmd = "shutdown /s /f /t 0"
            elif os_type == "macos":
                cmd = "pmset sleepnow"
            else:
                cmd = "sudo /sbin/shutdown -h now"

            print(f"[{name}] Initiating SSH command ({cmd}) for host ({host_ip})...")
            # Run SSH in background
            ssh_key_args = get_ssh_key_args()
            p = subprocess.Popen(
                ["ssh"] + ssh_key_args + [
                    "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                    f"{user}@{host_ip}", cmd
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            running_ssh_processes.append(p)
            
    # Wait for SSH commands to initiate
    for p in running_ssh_processes:
        p.wait()
        
    # 2. Wait 35 seconds if we triggered any PC shutdowns
    if hosts_shutting_down:
        print("Waiting 35 seconds for remote hosts to shut down gracefully...")
        time.sleep(35)
        
    # 3. Power off all plugs
    overall_success = True
    for plug in targets:
        p_id = plug.get("id")
        name = plug.get("name", plug.get("id"))
        print(f"[{name}] Turning off plug power...")
        res = subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", p_id])
        if res.returncode != 0:
            overall_success = False
        else:
            log_activity("plug", f"Stekker '{p_id}' uitgezet (afsluitsequentie voltooid)")
            
    if overall_success:
        print("✅ Success: All shutdown sequences completed.")
        sys.exit(0)
    else:
        print("❌ Error: Some plugs failed to turn off.")
        sys.exit(1)

if __name__ == "__main__":
    main()
