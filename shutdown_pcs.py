#!/usr/bin/env python3
import json
import os
import subprocess
import time
import sys

def get_settings():
    candidates = [
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

def detect_os(user, host_ip):
    # Returns "windows", "macos", or "linux"
    try:
        res = subprocess.run([
            "ssh", "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", 
            f"{user}@{host_ip}", "cmd.exe /c echo windows"
        ], capture_output=True, text=True, timeout=3)
        if "windows" in res.stdout.lower():
            return "windows"
    except Exception:
        pass
        
    try:
        res = subprocess.run([
            "ssh", "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", 
            f"{user}@{host_ip}", "uname"
        ], capture_output=True, text=True, timeout=3)
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
    user = settings.get("sshUser", "jeffreygo")
    
    print(f"=== Starting Shutdown for Plug: {name} (ID: {plug_id}) ===")
    
    if host_ip:
        print(f"[{name}] Detecting operating system for host ({host_ip})...")
        os_type = detect_os(user, host_ip)
        print(f"[{name}] Detected operating system: {os_type}")
        
        if os_type == "windows":
            cmd = "shutdown /s /f /t 0"
        elif os_type == "macos":
            cmd = "pmset sleepnow"
        else:
            cmd = "sudo /sbin/shutdown -h now"
            
        print(f"[{name}] Sending remote shutdown command ({cmd}) to host ({host_ip})...")
        subprocess.run([
            "ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", 
            f"{user}@{host_ip}", cmd
        ])
        print(f"[{name}] Waiting 15 seconds for host to shut down/sleep...")
        time.sleep(15)
        
    print(f"[{name}] Turning off plug power...")
    subprocess.run(["python3", "/app/control_plug.py", "off", plug_id])
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
        name = plug.get("name", plug.get("id"))
        if host_ip:
            hosts_shutting_down = True
            print(f"[{name}] Detecting operating system for host ({host_ip})...")
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
            p = subprocess.Popen([
                "ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", 
                f"{user}@{host_ip}", cmd
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            running_ssh_processes.append(p)
            
    # Wait for SSH commands to initiate
    for p in running_ssh_processes:
        p.wait()
        
    # 2. Wait 15 seconds if we triggered any PC shutdowns
    if hosts_shutting_down:
        print("Waiting 15 seconds for remote hosts to shut down gracefully...")
        time.sleep(15)
        
    # 3. Power off all plugs
    overall_success = True
    for plug in targets:
        p_id = plug.get("id")
        name = plug.get("name", plug.get("id"))
        print(f"[{name}] Turning off plug power...")
        res = subprocess.run(["python3", "/app/control_plug.py", "off", p_id])
        if res.returncode != 0:
            overall_success = False
            
    if overall_success:
        print("✅ Success: All shutdown sequences completed.")
        sys.exit(0)
    else:
        print("❌ Error: Some plugs failed to turn off.")
        sys.exit(1)

if __name__ == "__main__":
    main()
