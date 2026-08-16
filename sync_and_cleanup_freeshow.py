#!/usr/bin/env python3
import json
import os
import subprocess
import time
import base64
import sys
import glob

# Helper to intercept subprocess.run for ssh, scp, and sftp to enforce correct key permissions
def run_command_with_key(*args, **kwargs):
    cmd_list = args[0]
    if isinstance(cmd_list, list) and len(cmd_list) > 0:
        prog = cmd_list[0]
        if prog in ["ssh", "scp", "sftp"]:
            candidates = [
                "/app/data/id_ed25519",
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "id_ed25519"),
                "/volume1/docker/ark-livestream-manager/data/id_ed25519"
            ]
            ssh_key_args = []
            for c in candidates:
                if os.path.exists(c):
                    tmp_key = "/tmp/id_ed25519_temp"
                    try:
                        import shutil
                        shutil.copy2(c, tmp_key)
                        os.chmod(tmp_key, 0o600)
                        ssh_key_args = ["-i", tmp_key]
                        break
                    except:
                        pass
            
            new_cmd = [prog] + ssh_key_args + ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null"]
            i = 1
            while i < len(cmd_list):
                item = cmd_list[i]
                if item == "-o" and i + 1 < len(cmd_list) and ("StrictHostKeyChecking" in cmd_list[i+1] or "UserKnownHostsFile" in cmd_list[i+1]):
                    i += 2
                    continue
                new_cmd.append(item)
                i += 1
            args = (new_cmd,) + args[1:]
    elif isinstance(cmd_list, str):
        if cmd_list.startswith("scp ") or cmd_list.startswith("ssh ") or cmd_list.startswith("sftp "):
            prog = cmd_list.split()[0]
            candidates = [
                "/app/data/id_ed25519",
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "id_ed25519"),
                "/volume1/docker/ark-livestream-manager/data/id_ed25519"
            ]
            key_path = None
            for c in candidates:
                if os.path.exists(c):
                    tmp_key = "/tmp/id_ed25519_temp"
                    try:
                        import shutil
                        shutil.copy2(c, tmp_key)
                        os.chmod(tmp_key, 0o600)
                        key_path = tmp_key
                        break
                    except:
                        pass
            
            inject = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
            if key_path:
                inject += f" -i {key_path}"
            cmd_list = cmd_list.replace(prog, f"{prog} {inject}", 1)
            args = (cmd_list,) + args[1:]
            
    return original_run(*args, **kwargs)

original_run = subprocess.run
subprocess.run = run_command_with_key


def get_show_id_from_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                return data[0]
    except Exception as e:
        print(f"Error reading show ID from {file_path}: {e}")
    return None

def get_settings():
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(SCRIPT_DIR, "data", "settings.json"),
        "/volume1/docker/ark-livestream-manager/data/settings.json",
        "/app/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading settings file {c}: {e}")
    return {}

def detect_remote_os(user, host):
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "cmd.exe /c echo windows"],
        capture_output=True
    )
    stdout = res.stdout.decode('utf-8', errors='replace')
    if "windows" in stdout.lower():
        return "windows"
    return "macos"

def run_ssh_cmd(user, host, cmd_str):
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", cmd_str],
        capture_output=True
    )
    res.stdout = res.stdout.decode('utf-8', errors='replace')
    res.stderr = res.stderr.decode('utf-8', errors='replace')
    return res

def run_ps_script(user, host, script):
    encoded = base64.b64encode(script.encode('utf-16-le')).decode('utf-8')
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "powershell", "-EncodedCommand", encoded],
        capture_output=True
    )
    res.stdout = res.stdout.decode('utf-8', errors='replace')
    res.stderr = res.stderr.decode('utf-8', errors='replace')
    return res

def sftp_transfer(user, host, local_path, remote_path, direction):
    """
    Kopieert een bestand via SFTP batch mode.
    direction: 'get' (van remote naar local) of 'put' (van local naar remote).
    """
    # Voor Windows absolute paden in SFTP (bijv. C:/path), voeg een leidende slash toe zodat het niet relatief aan home is
    if ":" in remote_path and not remote_path.startswith("/"):
        parts = remote_path.split(":")
        if len(parts[0]) == 1 and parts[0].isalpha():
            remote_path = "/" + remote_path

    if direction == "get":
        cmd = f"get \"{remote_path}\" \"{local_path}\"\n"
    else:
        cmd = f"put \"{local_path}\" \"{remote_path}\"\n"
    res = subprocess.run(
        ["sftp", "-b", "-", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", f"{user}@{host}"],
        input=cmd.encode('utf-8'),
        capture_output=True
    )
    if res.returncode != 0:
        print(f"SFTP FOUT bij {direction} (local: {local_path}, remote: {remote_path}): {res.stderr.decode('utf-8', errors='replace')}")
        return False
    return True

def test_ssh(user, host):
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", "-o", "PasswordAuthentication=no", f"{user}@{host}", "echo 'online'"],
        capture_output=True
    )
    return res.returncode == 0

def wait_for_ssh(user, host, max_attempts=120):
    print(f"Waiting for remote host {host} to become available via SSH as user {user}...")
    for i in range(1, max_attempts + 1):
        if test_ssh(user, host):
            print(f"Host {host} is online!")
            return True
        time.sleep(2.5)
    return False

def get_projects_dir(settings):
    # Try default Synology path or Proxmox fallback path
    default_dir = "/volume1/Beamer/FreeShow/projects" if os.path.exists("/volume1/Beamer/FreeShow/projects") else "/mnt/data/Projects/Beamer/FreeShow/projects"
    thumb_path = settings.get("thumbnailSavePath")
    if thumb_path:
        base_dir_orig = os.path.dirname(thumb_path.rstrip("/"))
        projects_dir_orig = os.path.join(base_dir_orig, "projects")
        if os.path.exists(projects_dir_orig):
            return projects_dir_orig
    return default_dir

def main():
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] === STARTING FREESHOW SYNC & CLEANUP AUTOMATION ===")
    settings = get_settings()
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    
    delete_all_scriptures = "--delete-all-scriptures" in sys.argv
    if delete_all_scriptures:
        print("WIPE MODE: Direct deletion of ALL scripture shows requested.")

    keep_on = "--keep-on" in sys.argv
    if keep_on:
        print("KEEP-ON MODE: Beamer PC / smart plug will be left on after this run.")
    
    # 1. Configuration Check
    mac_user = settings.get("sshUser", "admin")
    mac_host = settings.get("freeShowHost", "192.168.2.101")
    if mac_host in ["localhost", "127.0.0.1", None]:
        mac_host = "192.168.2.101"
        
    nas_freeshow_path = settings.get("freeshowPath", "/volume1/Beamer/FreeShow").rstrip("/")
    nas_shows_dir = os.path.join(nas_freeshow_path, "Shows")
    
    if not os.path.exists(nas_shows_dir):
        print(f"ERROR: NAS Shows directory does not exist: {nas_shows_dir}")
        sys.exit(1)
        
    print(f"Target PC: {mac_user}@{mac_host}")
    print(f"NAS Shows directory: {nas_shows_dir}")
    
    local_only = "--local-only" in sys.argv
    if delete_all_scriptures and local_only:
        print("\n--- LOCAL WIPE MODE: Deleting scriptures only from NAS ---")
        deleted_count = 0
        for show_path in glob.glob(os.path.join(nas_shows_dir, "*.show")):
            try:
                with open(show_path, 'r', encoding='utf-8') as f:
                    show_data = json.load(f)
                if isinstance(show_data, list) and len(show_data) > 1:
                    category = show_data[1].get("category")
                    if category == "scripture":
                        os.remove(show_path)
                        print(f"Deleted from NAS: {os.path.basename(show_path)}")
                        deleted_count += 1
            except Exception as e:
                print(f"Error checking {show_path}: {e}")
        print(f"Local wipe complete. {deleted_count} scriptures removed.")
        print("Note: These will be deleted from the Beamer PC during the next full sync.")
        sys.exit(0)
    
    # 2. Power Management check
    is_pc_online = test_ssh(mac_user, mac_host)
    
    if not is_pc_online:
        print("Beamer PC is offline. Initiating remote startup sequence...")
        
        # Check if plug_beamer is configured
        plugs = settings.get("tuyaPlugs", [])
        beamer_plug = next((p for p in plugs if p.get("id") == "plug_beamer"), None)
        
        if beamer_plug:
            print("[Power] Turning ON smart plug 'plug_beamer'...")
            subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "on", "plug_beamer"])
            
            # Wait for host to boot and SSH to become available
            if wait_for_ssh(mac_user, mac_host):
                print("[Power] Beamer PC successfully started!")
                # Give the PC a few seconds to stabilize
                time.sleep(10)
            else:
                print("ERROR: Beamer PC did not respond to SSH after starting smart plug. Exiting.")
                sys.exit(1)
        else:
            print("ERROR: Beamer PC is offline and 'plug_beamer' is not configured in settings.json. Cannot perform sync.")
            sys.exit(1)
    else:
        print("Beamer PC is already online. Skipping startup sequence.")
        
    # Detect remote OS
    remote_os = detect_remote_os(mac_user, mac_host)
    print(f"Remote OS: {remote_os}")
    
    # Resolve remote paths
    remote_app_data_dir = ""
    remote_docs_dir = ""
    
    if remote_os == "windows":
        remote_app_data_dir = f"C:/Users/{mac_user}/AppData/Roaming/FreeShow"
        default_docs_dir = f"C:/Users/{mac_user}/Documents/FreeShow"
    else:
        remote_app_data_dir = f"/Users/{mac_user}/Library/Application Support/freeshow"
        default_docs_dir = f"/Users/{mac_user}/Documents/FreeShow"
        
    # Download remote settings.json to get remote dataPath
    local_temp_settings = "/tmp/remote_settings_sync.json"
    if sftp_transfer(mac_user, mac_host, local_temp_settings, f"{remote_app_data_dir}/settings.json", "get"):
        try:
            with open(local_temp_settings, 'r', encoding='utf-8') as f:
                remote_settings = json.load(f)
                remote_docs_dir = remote_settings.get("dataPath", default_docs_dir)
        except Exception as e:
            print(f"Warning: Failed to parse remote settings.json ({e}). Using default path.")
            remote_docs_dir = default_docs_dir
        finally:
            if os.path.exists(local_temp_settings):
                os.remove(local_temp_settings)
    else:
        print("Warning: Could not download remote settings.json. Using default path.")
        remote_docs_dir = default_docs_dir
        
    # If remote_docs_dir is a network share (e.g. Z:\FreeShow or \\NAS\FreeShow),
    # use the local fallback directory for synchronization.
    if remote_os == "windows" and (remote_docs_dir.lower().startswith("z:") or remote_docs_dir.startswith("\\\\")):
        print(f"Detected network share dataPath: {remote_docs_dir}. Using local fallback Documents directory for sync: {default_docs_dir}/Shows")
        remote_shows_dir = f"{default_docs_dir}/Shows"
    else:
        remote_shows_dir = f"{remote_docs_dir}/Shows"
    print(f"Remote Shows directory resolved: {remote_shows_dir}")
    
    # Load previous sync state
    state_file = os.path.join(SCRIPT_DIR, "data", "sync_state.json")
    if not os.path.exists(os.path.dirname(state_file)):
        os.makedirs(os.path.dirname(state_file), exist_ok=True)
        
    sync_state = {}
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                sync_state = json.load(f)
            print(f"Vorige sync state geladen. Bestanden in state: {len(sync_state)}")
        except Exception as e:
            print(f"Warning: Failed to load sync state ({e}). Starting fresh.")
            
    # 3. STAP 1: Oude Bijbelteksten (Scriptures) opschonen (> 7 dagen)
    print("\n--- STAP 1: SCRIPTURE OPSCHONING (> 7 dagen oud) ---")
    nas_shows = glob.glob(os.path.join(nas_shows_dir, "*.show"))
    deleted_ids = []
    now_ts = time.time()
    one_week_secs = 7 * 24 * 3600
    
    for show_path in nas_shows:
        show_file = os.path.basename(show_path)
        try:
            with open(show_path, 'r', encoding='utf-8') as f:
                show_data = json.load(f)
                
            if isinstance(show_data, list) and len(show_data) > 1:
                show_id = show_data[0]
                show_info = show_data[1]
                category = show_info.get("category")
                
                if category == "scripture":
                    mtime = os.path.getmtime(show_path)
                    
                    # Fallback to internal modified timestamp if available
                    timestamps = show_info.get("timestamps", {})
                    internal_modified = timestamps.get("modified")
                    if internal_modified:
                        mtime = internal_modified / 1000.0
                        
                    age_days = (now_ts - mtime) / (24 * 3600)
                    
                    if delete_all_scriptures or (now_ts - mtime > one_week_secs):
                        if delete_all_scriptures:
                            print(f"Scripture show '{show_info.get('name')}' opschonen (WIPE)...")
                        else:
                            print(f"Scripture show '{show_info.get('name')}' is {age_days:.1f} dagen oud. Opschonen...")
                        # Delete local NAS file
                        os.remove(show_path)
                        
                        # Delete remote file
                        remote_file_path = f"{remote_shows_dir}/{show_file}"
                        if remote_os == "windows":
                            run_ssh_cmd(mac_user, mac_host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
                        else:
                            run_ssh_cmd(mac_user, mac_host, f"rm -f \"{remote_file_path}\"")
                            
                        deleted_ids.append(show_id)
                        if show_file in sync_state:
                            del sync_state[show_file]
        except Exception as e:
            print(f"Fout bij verwerken van show {show_file} voor cleanup: {e}")
            
    # Note: remote shows.json index will be updated at the end of the script, after Step 2.
                    
    # 4. STAP 2: Twee-weg Synchronisatie (Sync)
    print("\n--- STAP 2: TWEE-WEG BIJWERKEN (NAS <-> BEAMER PC) ---")
    
    # NAS files listing
    nas_files = {}
    for f in glob.glob(os.path.join(nas_shows_dir, "*.show")):
        name = os.path.basename(f)
        nas_files[name] = {
            "path": f,
            "mtime": os.path.getmtime(f),
            "size": os.path.getsize(f)
        }
        
    # Remote Beamer PC files listing
    remote_files = {}
    if remote_os == "windows":
        ps_script = f"""
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $path = '{remote_shows_dir}'
        if (Test-Path $path) {{
            Get-ChildItem -Path $path -Filter '*.show' | ForEach-Object {{
                $_.Name + '|' + $_.Length + '|' + [datetimeoffset]::new($_.LastWriteTime).ToUnixTimeSeconds()
            }}
        }}
        """
        res_ps = run_ps_script(mac_user, mac_host, ps_script)
        if res_ps.returncode == 0:
            for line in res_ps.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        try:
                            remote_files[name] = {
                                "mtime": float(mtime_str),
                                "size": int(size_str)
                            }
                        except ValueError:
                            pass
        else:
            print(f"PowerShell error listing remote files: {res_ps.stderr}")
    else:
        cmd = f"python3 -c \"import os, glob; [print(os.path.basename(f) + '|' + str(os.path.getsize(f)) + '|' + str(os.path.getmtime(f))) for f in glob.glob('{remote_shows_dir}/*.show')]\""
        res_mac = run_ssh_cmd(mac_user, mac_host, cmd)
        if res_mac.returncode == 0:
            for line in res_mac.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        remote_files[name] = {
                            "mtime": float(mtime_str),
                            "size": int(size_str)
                        }
                        
    print(f"Aantal shows op NAS: {len(nas_files)}")
    print(f"Aantal shows op Beamer PC: {len(remote_files)}")
    
    # Deletion Propagation logic based on previous sync_state
    deletions_on_remote = []
    deletions_on_nas = []
    remote_ids_to_remove = []
    
    if sync_state:
        print("\n--- OPSPOREN VAN HANDMATIGE VERWIJDERINGEN ---")
        for name, state_info in list(sync_state.items()):
            # Case A: Deleted from NAS
            if name not in nas_files:
                print(f"Show '{name}' handmatig verwijderd van NAS. Propageren naar Beamer PC...")
                deletions_on_remote.append(name)
                show_id = state_info.get("id")
                if show_id:
                    remote_ids_to_remove.append(show_id)
                if name in remote_files:
                    del remote_files[name]
                
            # Case B: Deleted from Beamer PC
            elif name not in remote_files:
                print(f"Show '{name}' handmatig verwijderd van Beamer PC. Propageren naar NAS...")
                deletions_on_nas.append(name)
                show_id = state_info.get("id")
                if show_id:
                    remote_ids_to_remove.append(show_id)
                if name in nas_files:
                    del nas_files[name]
                    
        # Voer verwijderingen op NAS uit
        for name in deletions_on_nas:
            dest_path = os.path.join(nas_shows_dir, name)
            if os.path.exists(dest_path):
                try:
                    os.remove(dest_path)
                    print(f"Verwijderd van NAS: {name}")
                except Exception as e:
                    print(f"Fout bij verwijderen van NAS {name}: {e}")
                    
        # Voer verwijderingen op Beamer PC uit
        for name in deletions_on_remote:
            remote_file_path = f"{remote_shows_dir}/{name}"
            print(f"Verwijderen van Beamer PC: {name}...")
            if remote_os == "windows":
                run_ssh_cmd(mac_user, mac_host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
            else:
                run_ssh_cmd(mac_user, mac_host, f"rm -f \"{remote_file_path}\"")
                
        # Update remote shows.json index voor de handmatige verwijderingen
        if remote_ids_to_remove:
            print(f"Bijwerken van remote shows.json voor {len(remote_ids_to_remove)} handmatig verwijderde shows...")
            local_temp_shows = "/tmp/remote_shows_sync.json"
            if sftp_transfer(mac_user, mac_host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "get"):
                try:
                    with open(local_temp_shows, 'r', encoding='utf-8') as f:
                        shows_json_data = json.load(f)
                        
                    modified_index = False
                    for s_id in remote_ids_to_remove:
                        if s_id in shows_json_data:
                            del shows_json_data[s_id]
                            modified_index = True
                            
                    if modified_index:
                        with open(local_temp_shows, 'w', encoding='utf-8') as f:
                            json.dump(shows_json_data, f)
                        sftp_transfer(mac_user, mac_host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "put")
                        print("Remote shows.json succesvol bijgewerkt.")
                except Exception as e:
                    print(f"Fout bij bewerken van shows.json: {e}")
                finally:
                    if os.path.exists(local_temp_shows):
                        os.remove(local_temp_shows)
                        
    # 1. Beamer PC -> NAS (new or newer on remote)
    copied_to_nas = 0
    for name, r_info in remote_files.items():
        if name not in nas_files:
            print(f"Nieuwe show gedetecteerd op Beamer PC: '{name}'. Analyseren...")
            temp_dest = f"/tmp/temp_sync_{name}"
            if os.path.exists(temp_dest):
                os.remove(temp_dest)
                
            if sftp_transfer(mac_user, mac_host, temp_dest, f"{remote_shows_dir}/{name}", "get"):
                is_scripture = False
                try:
                    with open(temp_dest, 'r', encoding='utf-8') as f:
                        show_data = json.load(f)
                        if isinstance(show_data, list) and len(show_data) > 1:
                            is_scripture = show_data[1].get("category") == "scripture"
                except Exception as e:
                    print(f"Error checking category of remote show {name}: {e}")

                if is_scripture and (delete_all_scriptures or (now_ts - r_info["mtime"] > one_week_secs)):
                    print(f"Intercepted remote scripture '{name}' (expired/wipe). Deleting from Beamer PC...")
                    remote_file_path = f"{remote_shows_dir}/{name}"
                    if remote_os == "windows":
                        run_ssh_cmd(mac_user, mac_host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
                    else:
                        run_ssh_cmd(mac_user, mac_host, f"rm -f \"{remote_file_path}\"")
                    
                    show_id = get_show_id_from_file(temp_dest)
                    if show_id:
                        deleted_ids.append(show_id)
                    
                    if os.path.exists(temp_dest):
                        os.remove(temp_dest)
                else:
                    dest_path = os.path.join(nas_shows_dir, name)
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                    os.rename(temp_dest, dest_path)
                    os.utime(dest_path, (r_info["mtime"], r_info["mtime"]))
                    copied_to_nas += 1
        else:
            n_info = nas_files[name]
            if r_info["mtime"] - n_info["mtime"] > 2.0:
                print(f"Nieuwere versie gedetecteerd op Beamer PC: '{name}'. Analyseren...")
                temp_dest = f"/tmp/temp_sync_{name}"
                if os.path.exists(temp_dest):
                    os.remove(temp_dest)
                    
                if sftp_transfer(mac_user, mac_host, temp_dest, f"{remote_shows_dir}/{name}", "get"):
                    is_scripture = False
                    try:
                        with open(temp_dest, 'r', encoding='utf-8') as f:
                            show_data = json.load(f)
                            if isinstance(show_data, list) and len(show_data) > 1:
                                is_scripture = show_data[1].get("category") == "scripture"
                    except Exception as e:
                        print(f"Error checking category of remote show {name}: {e}")

                    if is_scripture and (delete_all_scriptures or (now_ts - r_info["mtime"] > one_week_secs)):
                        print(f"Intercepted newer remote scripture '{name}' (expired/wipe). Deleting from both...")
                        remote_file_path = f"{remote_shows_dir}/{name}"
                        if remote_os == "windows":
                            run_ssh_cmd(mac_user, mac_host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
                        else:
                            run_ssh_cmd(mac_user, mac_host, f"rm -f \"{remote_file_path}\"")
                        
                        dest_path = os.path.join(nas_shows_dir, name)
                        if os.path.exists(dest_path):
                            os.remove(dest_path)
                        
                        show_id = get_show_id_from_file(temp_dest)
                        if show_id:
                            deleted_ids.append(show_id)
                        
                        if os.path.exists(temp_dest):
                            os.remove(temp_dest)
                    else:
                        dest_path = os.path.join(nas_shows_dir, name)
                        if os.path.exists(dest_path):
                            os.remove(dest_path)
                        os.rename(temp_dest, dest_path)
                        os.utime(dest_path, (r_info["mtime"], r_info["mtime"]))
                        copied_to_nas += 1
                        
    # 2. NAS -> Beamer PC (new or newer on NAS)
    copied_to_remote = 0
    for name, n_info in nas_files.items():
        if name not in remote_files:
            print(f"Nieuwe show gedetecteerd op NAS: '{name}'. Kopieren naar Beamer PC...")
            if sftp_transfer(mac_user, mac_host, n_info["path"], f"{remote_shows_dir}/{name}", "put"):
                # Set mtime on remote PC
                if remote_os == "windows":
                    mtime_epoch = int(n_info["mtime"])
                    set_mtime_cmd = f"powershell -Command \"(Get-Item '{remote_shows_dir}/{name}').LastWriteTime = ([datetimeoffset]::FromUnixTimeSeconds({mtime_epoch})).DateTime\""
                    run_ssh_cmd(mac_user, mac_host, set_mtime_cmd)
                else:
                    run_ssh_cmd(mac_user, mac_host, f"touch -m -t {time.strftime('%Y%m%d%H%M.%S', time.localtime(n_info['mtime']))} '{remote_shows_dir}/{name}'")
                copied_to_remote += 1
        else:
            r_info = remote_files[name]
            if n_info["mtime"] - r_info["mtime"] > 2.0:
                print(f"Nieuwere versie gedetecteerd op NAS: '{name}'. Updaten op Beamer PC...")
                if sftp_transfer(mac_user, mac_host, n_info["path"], f"{remote_shows_dir}/{name}", "put"):
                    if remote_os == "windows":
                        mtime_epoch = int(n_info["mtime"])
                        set_mtime_cmd = f"powershell -Command \"(Get-Item '{remote_shows_dir}/{name}').LastWriteTime = ([datetimeoffset]::FromUnixTimeSeconds({mtime_epoch})).DateTime\""
                        run_ssh_cmd(mac_user, mac_host, set_mtime_cmd)
                    else:
                        run_ssh_cmd(mac_user, mac_host, f"touch -m -t {time.strftime('%Y%m%d%H%M.%S', time.localtime(n_info['mtime']))} '{remote_shows_dir}/{name}'")
                    copied_to_remote += 1
                    
    print(f"Sync afgerond. Kopieren naar NAS: {copied_to_nas}, Kopieren naar Beamer PC: {copied_to_remote}")
    
    # Update remote shows.json index for all deleted shows (if any)
    if deleted_ids:
        print(f"Bijwerken van remote shows.json voor {len(deleted_ids)} verwijderde shows...")
        local_temp_shows = "/tmp/remote_shows_sync.json"
        if os.path.exists(local_temp_shows):
            os.remove(local_temp_shows)
            
        if sftp_transfer(mac_user, mac_host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "get"):
            try:
                with open(local_temp_shows, 'r', encoding='utf-8') as f:
                    shows_json_data = json.load(f)
                    
                modified_index = False
                for s_id in deleted_ids:
                    if s_id in shows_json_data:
                        del shows_json_data[s_id]
                        modified_index = True
                        
                if modified_index:
                    with open(local_temp_shows, 'w', encoding='utf-8') as f:
                        json.dump(shows_json_data, f)
                    sftp_transfer(mac_user, mac_host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "put")
                    print("Remote shows.json index succesvol bijgewerkt.")
            except Exception as e:
                print(f"Fout bij bewerken van shows.json: {e}")
            finally:
                if os.path.exists(local_temp_shows):
                    os.remove(local_temp_shows)
                    
    # Save the updated sync state
    new_sync_state = {}
    current_nas_shows = glob.glob(os.path.join(nas_shows_dir, "*.show"))
    for show_path in current_nas_shows:
        name = os.path.basename(show_path)
        show_id = get_show_id_from_file(show_path)
        new_sync_state[name] = {
            "mtime": os.path.getmtime(show_path),
            "size": os.path.getsize(show_path),
            "id": show_id
        }
        
    try:
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(new_sync_state, f, indent=4)
        print("Synchronisatiestate succesvol bijgewerkt en opgeslagen.")
    except Exception as e:
        print(f"ERROR: Failed to save sync state file: {e}")
    
    # 5. Teardown / Shutdown sequence
    # Previously this only ran when turned_on_by_script was True, i.e. only
    # when THIS run was the one that switched the plug on. If the Beamer PC
    # was already on for any other reason (left on from a previous
    # incomplete run, used manually during the week, ...) the script skipped
    # both the startup AND the shutdown sequence, leaving the plug on
    # indefinitely - which is exactly the "still on after Wednesday" symptom.
    # The whole point of this nightly job is wake -> sync -> power off, so it
    # now always shuts down after a successful sync, regardless of who
    # turned the PC on - pass --keep-on to skip this for a manual/debug run.
    if keep_on:
        print("\n--- STAP 3: AFSLUITEN OVERGESLAGEN (--keep-on) ---")
    else:
        print("\n--- STAP 3: BEAMER PC NETJES AFSLUITEN ---")
        print(f"Sturen van afsluitcommando naar Beamer PC ({remote_os})...")
        if remote_os == "windows":
            run_ssh_cmd(mac_user, mac_host, "shutdown /s /f /t 0")
        else:
            run_ssh_cmd(mac_user, mac_host, "osascript -e 'tell application \"System Events\" to shut down'")
        print("Wachten op 15 seconden voor het veilig afsluiten...")
        time.sleep(15)
        print("[Power] Uitschakelen van smart plug 'plug_beamer'...")
        subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", "plug_beamer"])
        print("[Power] Stroom succesvol afgesloten.")

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] === FREESHOW SYNC & CLEANUP VOLTOOID ===")

if __name__ == "__main__":
    main()
