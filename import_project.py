#!/usr/bin/env python3
import zipfile
import json
import os
import shutil
import glob
import subprocess
import tempfile
import time

def get_settings():
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(SCRIPT_DIR, "data", "settings.json"),
        "/mnt/data/docker/ark-livestream-manager/data/settings.json",
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

def patch_paths(obj, old_prefixes, new_prefix):
    if isinstance(obj, str):
        for old_prefix in old_prefixes:
            if obj.startswith(old_prefix):
                return obj.replace(old_prefix, new_prefix, 1)
        return obj
    elif isinstance(obj, dict):
        return {k: patch_paths(v, old_prefixes, new_prefix) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [patch_paths(v, old_prefixes, new_prefix) for v in obj]
    return obj

def get_projects_dir(settings):
    default_dir = "/volume1/Beamer/FreeShow/projects" if os.path.exists("/volume1/Beamer/FreeShow/projects") else "/mnt/data/Projects/Beamer/FreeShow/projects"
    thumb_path = settings.get("thumbnailSavePath")
    
    if thumb_path:
        print(f"Found thumbnailSavePath in settings: {thumb_path}")
        
        # First try direct path without translation
        base_dir_orig = os.path.dirname(thumb_path.rstrip("/"))
        projects_dir_orig = os.path.join(base_dir_orig, "projects")
        if os.path.exists(projects_dir_orig):
            print(f"Resolved projects directory (direct): {projects_dir_orig}")
            return projects_dir_orig
            
        # Translate Synology NAS path to LXC host path if necessary
        translated = thumb_path.rstrip("/")
        if translated.startswith("/volume1/"):
            if translated.startswith("/volume1/Projects/"):
                translated = translated.replace("/volume1/Projects/", "/mnt/data/Projects/", 1)
            elif translated.startswith("/volume1/Beamer/"):
                translated = translated.replace("/volume1/Beamer/", "/mnt/data/Projects/Beamer/", 1)
            else:
                translated = translated.replace("/volume1/", "/mnt/data/Projects/", 1)
        
        # Sibling folder: replace 'Media' (or last folder) with 'projects'
        base_dir = os.path.dirname(translated)
        projects_dir = os.path.join(base_dir, "projects")
        
        if os.path.exists(projects_dir):
            print(f"Resolved projects directory: {projects_dir}")
            return projects_dir
        else:
            print(f"Derived projects path {projects_dir} does not exist on host.")
            
    print(f"Using default/fallback projects directory: {default_dir}")
    return default_dir

def detect_remote_os(user, host):
    print(f"Detecting operating system on remote host {host}...")
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "cmd.exe /c echo windows"],
        capture_output=True, text=True
    )
    if "windows" in res.stdout.lower():
        print("Remote OS detected: Windows 10")
        return "windows"
    print("Remote OS detected: macOS/Linux")
    return "macos"

def import_project():
    settings = get_settings()
    projects_dir = get_projects_dir(settings)
    
    project_files = glob.glob(os.path.join(projects_dir, "*.project"))
    if not project_files:
        print(f"No .project files found in {projects_dir}")
        return False
        
    # Find the newest project file by modification time
    latest_project = max(project_files, key=os.path.getmtime)
    print(f"Latest project file found: {latest_project}")
    
    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="freeshow_import_")
    
    try:
        # Extract zip
        with zipfile.ZipFile(latest_project, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
            
        data_json_path = os.path.join(temp_dir, "data.json")
        if not os.path.exists(data_json_path):
            print("data.json not found in project file")
            return False
            
        with open(data_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        project_obj = data.get("project")
        if not project_obj:
            print("No 'project' key in data.json")
            return False
            
        project_id = project_obj.get("id")
        project_name = project_obj.get("name")
        shows_dict = data.get("shows", {})
        
        print(f"Importing project '{project_name}' (ID: {project_id}) with {len(shows_dict)} shows")
        
        mac_user = settings.get("sshUser", "jeffreygo")
        mac_host = settings.get("freeShowHost", "192.168.2.20")
        if mac_host in ["localhost", "127.0.0.1", None]:
            mac_host = "192.168.2.20" # Fallback to Mac Mini
            
        # Detect remote OS to configure paths
        remote_os = detect_remote_os(mac_user, mac_host)
        
        if remote_os == "windows":
            remote_app_data_dir = f"C:/Users/{mac_user}/AppData/Roaming/FreeShow"
            default_docs_dir = f"C:/Users/{mac_user}/Documents/FreeShow"
            # Stop FreeShow on Windows
            print("Stopping FreeShow on Windows PC if running...")
            subprocess.run(["ssh", "-o", "ConnectTimeout=3", f"{mac_user}@{mac_host}", "taskkill /f /im FreeShow.exe 2>NUL || exit 0"])
        else:
            remote_app_data_dir = f"/Users/{mac_user}/Library/Application Support/freeshow"
            default_docs_dir = f"/Users/{mac_user}/Documents/FreeShow"
            # Stop FreeShow on macOS
            print("Stopping FreeShow on Mac if running...")
            subprocess.run(["ssh", "-o", "ConnectTimeout=3", f"{mac_user}@{mac_host}", "killall FreeShow 2>/dev/null || true"])
            
        # Download settings.json first to resolve the dataPath
        local_settings_json = os.path.join(temp_dir, "settings.json")
        print("Downloading settings.json from remote host to check for custom dataPath...")
        res_settings = subprocess.run(["scp", f"{mac_user}@{mac_host}:{remote_app_data_dir}/settings.json", local_settings_json], capture_output=True)
        
        remote_docs_dir = default_docs_dir
        settings_data = {}
        
        if res_settings.returncode == 0:
            try:
                with open(local_settings_json, 'r', encoding='utf-8') as f:
                    settings_data = json.load(f)
                if settings_data.get("dataPath"):
                    remote_docs_dir = settings_data["dataPath"]
                    print(f"Detected custom FreeShow dataPath from settings.json: {remote_docs_dir}")
            except Exception as e:
                print(f"Failed to parse settings.json: {e}")
        else:
            print("Could not download settings.json. Initializing default settings data.")
            settings_data = {
                "initialized": True,
                "dataPath": default_docs_dir,
                "showsPath": f"{default_docs_dir}/Shows",
                "activeProject": None
            }

        # Patch generator media paths inside project to match remote client's dataPath/remote_docs_dir
        generator_path = settings.get("freeshowPath", "/mnt/data/Projects/Beamer/FreeShow").rstrip("/")
        old_prefixes = [
            generator_path,
            "/mnt/data/Projects/Beamer/FreeShow",
            "/volume1/Projects/Beamer/FreeShow",
            "/volume1/Beamer/FreeShow"
        ]
        
        print(f"Patching project paths from generator path prefixes to remote dataPath: {remote_docs_dir}")
        project_obj = patch_paths(project_obj, old_prefixes, remote_docs_dir)
        shows_dict = patch_paths(shows_dict, old_prefixes, remote_docs_dir)

        # Download existing config files from remote host
        # projects.json
        local_projects_json = os.path.join(temp_dir, "projects.json")
        res = subprocess.run(["scp", f"{mac_user}@{mac_host}:{remote_docs_dir}/Config/projects.json", local_projects_json], capture_output=True)
        if res.returncode != 0:
            print("Could not download projects.json. Initializing new one.")
            projects_data = {
                "projects": {},
                "folders": {},
                "projectTemplates": {}
            }
        else:
            try:
                with open(local_projects_json, 'r', encoding='utf-8') as f:
                    projects_data = json.load(f)
            except Exception as e:
                print(f"Failed to parse projects.json: {e}. Reinitializing.")
                projects_data = {
                    "projects": {},
                    "folders": {},
                    "projectTemplates": {}
                }
                
        # shows.json
        local_shows_json = os.path.join(temp_dir, "shows.json")
        res = subprocess.run(["scp", f"{mac_user}@{mac_host}:{remote_app_data_dir}/shows.json", local_shows_json], capture_output=True)
        if res.returncode != 0:
            print("Could not download shows.json. Initializing new one.")
            shows_data = {}
        else:
            try:
                with open(local_shows_json, 'r', encoding='utf-8') as f:
                    shows_data = json.load(f)
            except Exception as e:
                print(f"Failed to parse shows.json: {e}. Reinitializing.")
                shows_data = {}
                
        # 1. Update projects.json
        projects_data.setdefault("projects", {})[project_id] = project_obj
        with open(local_projects_json, 'w', encoding='utf-8') as f:
            json.dump(projects_data, f, indent=4)
            
        # 2. Update shows.json and generate individual .show files
        local_shows_dir = os.path.join(temp_dir, "Shows")
        os.makedirs(local_shows_dir, exist_ok=True)
        
        for show_id, show_val in shows_dict.items():
            shows_data[show_id] = {
                "name": show_val.get("name"),
                "category": show_val.get("category", "presentation"),
                "timestamps": show_val.get("timestamps", {
                    "created": int(time.time() * 1000),
                    "modified": int(time.time() * 1000),
                    "used": int(time.time() * 1000)
                }),
                "quickAccess": show_val.get("quickAccess", {})
            }
            show_filename = show_val.get("name") + ".show"
            for char in ['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>']:
                show_filename = show_filename.replace(char, '_')
            
            show_file_path = os.path.join(local_shows_dir, show_filename)
            with open(show_file_path, 'w', encoding='utf-8') as sf:
                json.dump([show_id, show_val], sf)
                
        with open(local_shows_json, 'w', encoding='utf-8') as f:
            json.dump(shows_data, f)
            
        # 3. Update settings.json to set active project
        settings_data["activeProject"] = project_id
        settings_data["showsPath"] = remote_docs_dir
        settings_data["dataPath"] = remote_docs_dir
        with open(local_settings_json, 'w', encoding='utf-8') as f:
            json.dump(settings_data, f, indent=4)
            
        # Check if remote_docs_dir is mapped to the local generator path (network share)
        is_network_share = False
        if remote_os == "windows" and (remote_docs_dir.startswith("Z:") or remote_docs_dir.startswith("\\\\")):
            is_network_share = True
            print("Target dataPath is a network share. Copying shows, projects.json, and extra files directly to the local shared directory...")
            
        if is_network_share:
            # Create local directories if they don't exist
            os.makedirs(os.path.join(generator_path, "Shows"), exist_ok=True)
            os.makedirs(os.path.join(generator_path, "Config"), exist_ok=True)
            
            # Create remote app data directory only
            print("Creating target AppData directory on remote host...")
            cmd = f"powershell -Command \"New-Item -ItemType Directory -Force -Path '{remote_app_data_dir}'\""
            subprocess.run(["ssh", f"{mac_user}@{mac_host}", cmd], check=True)
            
            # Copy individual .show files locally
            print("Copying .show files locally to the network share...")
            for f in glob.glob(os.path.join(local_shows_dir, "*")):
                shutil.copy2(f, os.path.join(generator_path, "Shows"))
                
            # Copy other extracted files (except config/metadata) locally to network share
            for root, dirs, files in os.walk(temp_dir):
                if 'Shows' in dirs:
                    dirs.remove('Shows')
                for file in files:
                    if file in ["data.json", "projects.json", "shows.json", "settings.json", ".DS_Store"]:
                        continue
                    abs_path = os.path.join(root, file)
                    rel_path = os.path.relpath(abs_path, temp_dir)
                    dest_file_path = os.path.join(generator_path, rel_path)
                    os.makedirs(os.path.dirname(dest_file_path), exist_ok=True)
                    print(f"Copying extra file locally: {rel_path}")
                    shutil.copy2(abs_path, dest_file_path)
                    
            # Copy projects.json locally
            print("Copying projects.json locally to the network share...")
            shutil.copy2(local_projects_json, os.path.join(generator_path, "Config", "projects.json"))
            
            # Upload shows.json and settings.json via scp to target PC AppData
            print("Uploading shows.json and settings.json to remote AppData...")
            subprocess.run(["scp", local_shows_json, f"{mac_user}@{mac_host}:{remote_app_data_dir}/shows.json"], check=True)
            subprocess.run(["scp", local_settings_json, f"{mac_user}@{mac_host}:{remote_app_data_dir}/settings.json"], check=True)

            # Copy thema.jpg on network share to ensure it exists in both paths
            local_thema_src = None
            thema_candidates = [
                os.path.join(generator_path, "Media", "thema.jpg"),
                os.path.join(generator_path, "thema.jpg"),
                "/volume1/Beamer/FreeShow/Media/thema.jpg",
                "/volume1/Beamer/FreeShow/thema.jpg",
                "/app/public/thumbnails/thema.jpg"
            ]
            for c in thema_candidates:
                if os.path.exists(c):
                    local_thema_src = c
                    break
            
            if local_thema_src:
                try:
                    dest_1 = os.path.join(generator_path, "thema.jpg")
                    dest_2 = os.path.join(generator_path, "Media", "thema.jpg")
                    if local_thema_src != dest_1:
                        shutil.copy2(local_thema_src, dest_1)
                    if local_thema_src != dest_2:
                        shutil.copy2(local_thema_src, dest_2)
                    print(f"Copied thema.jpg to network share paths: {dest_1} and {dest_2}")
                except Exception as e:
                    print(f"Warning: Failed to copy thema.jpg locally: {e}")
        else:
            # Create remote directories (including Media)
            print("Creating target directories on remote host...")
            if remote_os == "windows":
                cmd = f"powershell -Command \"New-Item -ItemType Directory -Force -Path '{remote_docs_dir}/Shows', '{remote_docs_dir}/Config', '{remote_docs_dir}/Media', '{remote_app_data_dir}'\""
            else:
                cmd = f"mkdir -p '{remote_docs_dir}/Shows' '{remote_docs_dir}/Config' '{remote_docs_dir}/Media' '{remote_app_data_dir}'"
                
            subprocess.run(["ssh", f"{mac_user}@{mac_host}", cmd], check=True)
            
            # Copy individual .show files
            print("Uploading .show files...")
            subprocess.run(f"scp {local_shows_dir}/* {mac_user}@{mac_host}:{remote_docs_dir}/Shows/", shell=True, check=True)
            
            # Copy other extracted files (except config/metadata)
            for root, dirs, files in os.walk(temp_dir):
                if 'Shows' in dirs:
                    dirs.remove('Shows')
                for file in files:
                    if file in ["data.json", "projects.json", "shows.json", "settings.json", ".DS_Store"]:
                        continue
                    abs_path = os.path.join(root, file)
                    rel_path = os.path.relpath(abs_path, temp_dir)
                    dest_dir = os.path.dirname(f"{remote_docs_dir}/{rel_path}")
                    print(f"Uploading extra file: {rel_path}")
                    if remote_os == "windows":
                        mkdir_cmd = f"powershell -Command \"New-Item -ItemType Directory -Force -Path '{dest_dir}'\""
                    else:
                        mkdir_cmd = f"mkdir -p '{dest_dir}'"
                    subprocess.run(["ssh", f"{mac_user}@{mac_host}", mkdir_cmd], check=True)
                    subprocess.run(["scp", abs_path, f"{mac_user}@{mac_host}:{remote_docs_dir}/{rel_path}"], check=True)
                    
            # Upload updated config files
            print("Uploading updated configuration files...")
            subprocess.run(["scp", local_projects_json, f"{mac_user}@{mac_host}:{remote_docs_dir}/Config/projects.json"], check=True)
            subprocess.run(["scp", local_shows_json, f"{mac_user}@{mac_host}:{remote_app_data_dir}/shows.json"], check=True)
            subprocess.run(["scp", local_settings_json, f"{mac_user}@{mac_host}:{remote_app_data_dir}/settings.json"], check=True)

            # Upload thema.jpg to remote host
            local_thema_src = None
            thema_candidates = [
                os.path.join(generator_path, "Media", "thema.jpg"),
                os.path.join(generator_path, "thema.jpg"),
                "/volume1/Beamer/FreeShow/Media/thema.jpg",
                "/volume1/Beamer/FreeShow/thema.jpg",
                "/app/public/thumbnails/thema.jpg"
            ]
            for c in thema_candidates:
                if os.path.exists(c):
                    local_thema_src = c
                    break
            
            if local_thema_src:
                print("Uploading thema.jpg to remote host...")
                try:
                    subprocess.run(["scp", local_thema_src, f"{mac_user}@{mac_host}:{remote_docs_dir}/thema.jpg"], check=False)
                    subprocess.run(["scp", local_thema_src, f"{mac_user}@{mac_host}:{remote_docs_dir}/Media/thema.jpg"], check=False)
                    print("thema.jpg uploaded successfully to remote host.")
                except Exception as e:
                    print(f"Warning: Failed to upload thema.jpg to remote host: {e}")
        
        print(f"Project '{project_name}' successfully imported and set as active!")
        return True
        
    except Exception as e:
        print(f"Error importing project: {e}")
        return False
    finally:
        # Clean up temp dir
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    import_project()
