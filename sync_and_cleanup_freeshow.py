#!/usr/bin/env python3
import json
import os
import subprocess
import time
import base64
import sys
import glob
import shutil

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

    res_uname = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "uname -s"],
        capture_output=True
    )
    if res_uname.stdout.decode('utf-8', errors='replace').strip().lower().startswith("linux"):
        return "linux"
    return "macos"

def is_network_mount(user, host, remote_os, path):
    """
    Checks whether `path` on the remote host sits on a network-mounted
    filesystem (SMB/CIFS/NFS/AFP) instead of the machine's own local disk.
    Syncing a "local" directory that is actually a network mount against
    the NAS would silently compare that share to itself and never protect
    FreeShow from network latency, so this is used to fall back to a
    genuinely local directory instead.
    """
    if remote_os == "windows":
        lowered = path.lower()
        return lowered.startswith("z:") or path.startswith("\\\\") or path.startswith("//")

    if remote_os == "linux":
        res = run_ssh_cmd(user, host, f"findmnt -no FSTYPE --target \"{path}\" 2>/dev/null")
        fstype = res.stdout.strip().lower()
        network_fs_types = {"cifs", "smb3", "smbfs", "nfs", "nfs3", "nfs4", "9p", "fuse.sshfs", "fuse.rclone"}
        return fstype in network_fs_types

    # macOS: `mount` lists each mounted filesystem with its type in
    # parentheses, e.g. "//user@server/share on /Volumes/Projects (smbfs, ...)".
    # A path is network-mounted if it equals or lives under one of those
    # mount points.
    res = run_ssh_cmd(user, host, "mount")
    network_mount_points = []
    for line in res.stdout.splitlines():
        if "(smbfs" in line or "(afpfs" in line or "(nfs" in line:
            if " on " in line:
                mount_point = line.split(" on ", 1)[1].split(" (")[0].strip()
                network_mount_points.append(mount_point.rstrip("/"))

    normalized_path = path.rstrip("/")
    return any(normalized_path == mp or normalized_path.startswith(mp + "/") for mp in network_mount_points)

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

def list_remote_files(user, host, remote_os, remote_dir):
    """
    Lists every file (not directories) directly inside `remote_dir` on the
    Beamer PC, as {name: {mtime, size}}. Extension/name filtering is left
    to the caller so this stays a single reusable listing path for Shows,
    Media, Bibles and Templates.
    """
    remote_files = {}
    if remote_os == "windows":
        ps_script = f"""
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $path = '{remote_dir}'
        if (Test-Path $path) {{
            Get-ChildItem -Path $path -File | ForEach-Object {{
                $_.Name + '|' + $_.Length + '|' + [datetimeoffset]::new($_.LastWriteTime).ToUnixTimeSeconds()
            }}
        }}
        """
        res_ps = run_ps_script(user, host, ps_script)
        if res_ps.returncode == 0:
            for line in res_ps.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        try:
                            remote_files[name] = {"mtime": float(mtime_str), "size": int(size_str)}
                        except ValueError:
                            pass
        else:
            print(f"PowerShell error listing remote files in {remote_dir}: {res_ps.stderr}")
    else:
        cmd = (
            "python3 -c \"import os, glob; "
            f"[print(os.path.basename(f) + '|' + str(os.path.getsize(f)) + '|' + str(os.path.getmtime(f))) "
            f"for f in glob.glob('{remote_dir}/*') if os.path.isfile(f)]\""
        )
        res = run_ssh_cmd(user, host, cmd)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        try:
                            remote_files[name] = {"mtime": float(mtime_str), "size": int(size_str)}
                        except ValueError:
                            pass
    return remote_files

def list_remote_files_recursive(user, host, remote_os, remote_dir):
    """
    Like list_remote_files, but walks subdirectories too. Keys are
    forward-slash-separated paths relative to `remote_dir` (e.g.
    "events/2026/thema.jpg"), used for folders like Media that are
    organised into subfolders.
    """
    remote_files = {}
    if remote_os == "windows":
        ps_script = f"""
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $path = '{remote_dir}'
        if (Test-Path $path) {{
            Get-ChildItem -Path $path -File -Recurse | ForEach-Object {{
                $rel = $_.FullName.Substring($path.Length).TrimStart('\\','/') -replace '\\\\','/'
                $rel + '|' + $_.Length + '|' + [datetimeoffset]::new($_.LastWriteTime).ToUnixTimeSeconds()
            }}
        }}
        """
        res_ps = run_ps_script(user, host, ps_script)
        if res_ps.returncode == 0:
            for line in res_ps.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        try:
                            remote_files[name] = {"mtime": float(mtime_str), "size": int(size_str)}
                        except ValueError:
                            pass
        else:
            print(f"PowerShell error listing remote files in {remote_dir}: {res_ps.stderr}")
    else:
        cmd = (
            "python3 -c \"import os; "
            f"base = '{remote_dir}'; "
            "[print(os.path.relpath(os.path.join(r, fn), base).replace(os.sep, '/') + '|' + "
            "str(os.path.getsize(os.path.join(r, fn))) + '|' + str(os.path.getmtime(os.path.join(r, fn)))) "
            "for r, d, files in os.walk(base) for fn in files]\""
        )
        res = run_ssh_cmd(user, host, cmd)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                line = line.strip()
                if line and "|" in line:
                    parts = line.split("|")
                    if len(parts) == 3:
                        name, size_str, mtime_str = parts
                        try:
                            remote_files[name] = {"mtime": float(mtime_str), "size": int(size_str)}
                        except ValueError:
                            pass
    return remote_files

def apply_safety_guard(label, deletions_a, deletions_b, known_count):
    """
    Refuses to trust a deletion batch that looks like "one side is
    unexpectedly empty" rather than a real, deliberate cleanup. Requires
    both an absolute minimum count AND a share of the previously known
    catalog before proceeding - otherwise returns empty deletion lists so
    the caller performs no removals this run (new/changed files still
    sync normally).
    """
    SAFETY_MIN_COUNT = 5
    SAFETY_MIN_RATIO = 0.3  # 30% of the previously known catalog

    total = len(deletions_a) + len(deletions_b)
    if total >= SAFETY_MIN_COUNT and total >= SAFETY_MIN_RATIO * known_count:
        print(f"\n!!! VEILIGHEIDSSTOP ({label}): {total} van de {known_count} bekende bestanden lijken "
              f"verwijderd (kant A: {len(deletions_a)}, kant B: {len(deletions_b)}).")
        print("Dit is te groot om automatisch te vertrouwen als een echte opschoning - het kan ook een "
              "lege/onbereikbare map zijn (bv. verkeerde dataPath, niet gemounte schijf). Er wordt deze "
              "run NIETS verwijderd voor deze map; nieuwe/gewijzigde bestanden worden wel gewoon "
              "gesynchroniseerd.")
        print("Los de oorzaak op en draai de sync opnieuw, of pas data/sync_state.json handmatig aan als "
              "dit toch de bedoeling was.")
        return [], [], True
    return deletions_a, deletions_b, False

def _scan_local_tree(base_dir, matches):
    """Recursively lists files under base_dir as {relative_path: info}, using
    forward-slash-separated relative paths so keys line up with the remote
    listing regardless of host OS."""
    found = {}
    for root, _dirs, files in os.walk(base_dir):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, base_dir).replace(os.sep, "/")
            if matches(rel):
                found[rel] = {"path": full, "mtime": os.path.getmtime(full), "size": os.path.getsize(full)}
    return found

def sync_simple_folder(label, nas_dir, remote_dir, mac_user, mac_host, remote_os, folder_state,
                        extensions=None, exclude_names=None):
    """
    Two-way, deletion-safe sync of one folder tree (Media, Bibles,
    Templates), including subfolders, between the NAS and the Beamer PC.
    Unlike the Shows sync this has no scripture-expiry or shows.json-index
    handling - it just mirrors files both ways and applies the same
    mass-deletion safety guard as Shows.

    `folder_state` is the previous {relative_path: {mtime, size}} state for
    this folder (from sync_state.json). Returns (new_folder_state, stats).
    """
    exclude_names = exclude_names or set()
    stats = {"copied_to_nas": 0, "copied_to_remote": 0, "deleted_nas": 0, "deleted_remote": 0, "skipped": False}

    if not os.path.isdir(nas_dir):
        print(f"[{label}] NAS-map bestaat niet ({nas_dir}) - overgeslagen.")
        stats["skipped"] = True
        return folder_state, stats

    print(f"\n--- SYNC: {label} ---")

    # SFTP's "put" fails outright if the destination directory doesn't
    # exist yet (it never auto-creates it) - Media/Bibles in particular
    # may not exist on a freshly pointed-at local FreeShow data folder.
    _ensure_remote_dir(mac_user, mac_host, remote_os, remote_dir)
    ensured_remote_dirs = {remote_dir}

    def ensure_remote_parent(relative_path):
        parent = "/".join(relative_path.split("/")[:-1])
        if not parent:
            return
        full_remote_parent = f"{remote_dir}/{parent}"
        if full_remote_parent not in ensured_remote_dirs:
            _ensure_remote_dir(mac_user, mac_host, remote_os, full_remote_parent)
            ensured_remote_dirs.add(full_remote_parent)

    def matches(name):
        base = name.rsplit("/", 1)[-1]
        if base in exclude_names:
            return False
        if extensions is None:
            return True
        return os.path.splitext(base)[1].lower() in extensions

    nas_files = _scan_local_tree(nas_dir, matches)

    remote_files_all = list_remote_files_recursive(mac_user, mac_host, remote_os, remote_dir)
    remote_files = {name: info for name, info in remote_files_all.items() if matches(name)}

    print(f"[{label}] Aantal op NAS: {len(nas_files)}, aantal op Beamer PC: {len(remote_files)}")

    deletions_on_nas = []
    deletions_on_remote = []

    if folder_state:
        for name in list(folder_state.keys()):
            if name not in nas_files:
                deletions_on_remote.append(name)
            elif name not in remote_files:
                deletions_on_nas.append(name)

        deletions_on_nas, deletions_on_remote, tripped = apply_safety_guard(
            label, deletions_on_nas, deletions_on_remote, len(folder_state)
        )

        # Only now remove the confirmed deletions from the working sets, so
        # that when the guard trips (deletions cleared) nas_files/
        # remote_files stay fully intact and the copy step below still
        # transfers everything normally instead of silently skipping it.
        for name in deletions_on_remote:
            if name in remote_files:
                del remote_files[name]
        for name in deletions_on_nas:
            if name in nas_files:
                del nas_files[name]

        for name in deletions_on_nas:
            dest_path = os.path.join(nas_dir, name)
            if os.path.exists(dest_path):
                try:
                    os.remove(dest_path)
                    print(f"[{label}] Verwijderd van NAS: {name}")
                    stats["deleted_nas"] += 1
                except Exception as e:
                    print(f"[{label}] Fout bij verwijderen van NAS {name}: {e}")

        for name in deletions_on_remote:
            remote_file_path = f"{remote_dir}/{name}"
            if remote_os == "windows":
                run_ssh_cmd(mac_user, mac_host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
            else:
                run_ssh_cmd(mac_user, mac_host, f"rm -f \"{remote_file_path}\"")
            print(f"[{label}] Verwijderd van Beamer PC: {name}")
            stats["deleted_remote"] += 1

    # Beamer PC -> NAS (new or newer on remote)
    for name, r_info in remote_files.items():
        remote_path = f"{remote_dir}/{name}"
        if name not in nas_files:
            dest_path = os.path.join(nas_dir, name)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            if sftp_transfer(mac_user, mac_host, dest_path, remote_path, "get"):
                _safe_chmod(dest_path)
                _safe_utime(dest_path, r_info["mtime"])
                stats["copied_to_nas"] += 1
                print(f"[{label}] Nieuw op Beamer PC, gekopieerd naar NAS: {name}")
        else:
            n_info = nas_files[name]
            if r_info["mtime"] - n_info["mtime"] > 2.0:
                if sftp_transfer(mac_user, mac_host, n_info["path"], remote_path, "get"):
                    _safe_chmod(n_info["path"])
                    _safe_utime(n_info["path"], r_info["mtime"])
                    stats["copied_to_nas"] += 1
                    print(f"[{label}] Nieuwere versie op Beamer PC, bijgewerkt op NAS: {name}")

    # NAS -> Beamer PC (new or newer on NAS)
    for name, n_info in nas_files.items():
        remote_path = f"{remote_dir}/{name}"
        if name not in remote_files:
            ensure_remote_parent(name)
            if sftp_transfer(mac_user, mac_host, n_info["path"], remote_path, "put"):
                _touch_remote(mac_user, mac_host, remote_os, remote_path, n_info["mtime"])
                stats["copied_to_remote"] += 1
                print(f"[{label}] Nieuw op NAS, gekopieerd naar Beamer PC: {name}")
        else:
            r_info = remote_files[name]
            if n_info["mtime"] - r_info["mtime"] > 2.0:
                ensure_remote_parent(name)
                if sftp_transfer(mac_user, mac_host, n_info["path"], remote_path, "put"):
                    _touch_remote(mac_user, mac_host, remote_os, remote_path, n_info["mtime"])
                    stats["copied_to_remote"] += 1
                    print(f"[{label}] Nieuwere versie op NAS, bijgewerkt op Beamer PC: {name}")

    print(f"[{label}] Klaar. Naar NAS: {stats['copied_to_nas']}, naar Beamer PC: {stats['copied_to_remote']}, "
          f"verwijderd NAS: {stats['deleted_nas']}, verwijderd Beamer PC: {stats['deleted_remote']}")

    # Fresh rescan for the saved state, so an aborted/guarded deletion
    # never gets "forgotten" from state despite the file still existing.
    new_state = _scan_local_tree(nas_dir, matches)
    new_state = {name: {"mtime": info["mtime"], "size": info["size"]} for name, info in new_state.items()}

    return new_state, stats

def _ensure_remote_dir(user, host, remote_os, remote_dir):
    if remote_os == "windows":
        run_ssh_cmd(user, host, f"cmd.exe /c if not exist \"{remote_dir}\" mkdir \"{remote_dir}\"")
    else:
        run_ssh_cmd(user, host, f"mkdir -p '{remote_dir}'")

def _safe_utime(path, mtime):
    """
    Sets a file's mtime, but never lets that fail the whole sync. NFS
    (root-squashed or otherwise) can refuse utime() with EPERM for a file
    this process doesn't own even when the file is world-writable - mtime
    changes require real ownership on some servers, unlike a plain write.
    The file's content still gets copied correctly either way; only the
    cosmetic "matches the source's timestamp" property is lost for that
    one file, which just means it may be re-compared (and safely re-copied,
    not re-deleted) on the next run instead of being considered in sync.
    """
    try:
        os.utime(path, (mtime, mtime))
    except OSError as e:
        print(f"Waarschuwing: kon wijzigingsdatum niet zetten op {path} ({e}) - bestand zelf is wel correct gekopieerd.")

def _safe_chmod(path):
    """
    Makes a freshly pulled-in file world-writable, matching every other
    file in this NAS-side tree. Without this, a file written while this
    script runs as root (e.g. inside the tuya-control container) ends up
    owner-only (rw-------), unreadable by the app's own container user
    and by anyone SSHed in as a regular account - exactly the kind of
    silent lockout that made a real sync run look like data loss. Best
    effort only, same reasoning as _safe_utime: NFS can still refuse a
    chmod for a file this process doesn't truly own even after writing
    it, and that must never fail the sync itself.
    """
    try:
        os.chmod(path, 0o666)
    except OSError as e:
        print(f"Waarschuwing: kon rechten niet zetten op {path} ({e}) - bestand zelf is wel correct gekopieerd.")

def _status_path(script_dir):
    return os.path.join(script_dir, "data", "sync_status.json")

def _write_sync_status(script_dir, **fields):
    """
    Best-effort write of data/sync_status.json, merging the given top-level
    fields into whatever is already there. Used by the app's UI to show sync
    progress and a completion notification - never allowed to fail the sync
    itself if the file can't be read/written for some reason.
    """
    path = _status_path(script_dir)
    try:
        current = {}
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    current = json.load(f)
            except Exception:
                current = {}
        current.update(fields)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(current, f, indent=2)
        os.replace(tmp, path)
    except Exception as e:
        print(f"Waarschuwing: kon sync_status.json niet bijwerken ({e}) - dit heeft geen invloed op de sync zelf.")

def _update_target_status(script_dir, key, status):
    """Best-effort update of a single target's status within sync_status.json."""
    path = _status_path(script_dir)
    try:
        current = {}
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    current = json.load(f)
            except Exception:
                current = {}
        found = False
        for t in current.get("targets", []):
            if t.get("key") == key:
                t["status"] = status
                found = True
                break
        if not found:
            current.setdefault("targets", []).append({"key": key, "status": status})
        tmp = path + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(current, f, indent=2)
        os.replace(tmp, path)
    except Exception as e:
        print(f"Waarschuwing: kon sync_status.json niet bijwerken voor doel '{key}' ({e}) - dit heeft geen invloed op de sync zelf.")

def _touch_remote(user, host, remote_os, remote_path, mtime):
    if remote_os == "windows":
        mtime_epoch = int(mtime)
        set_mtime_cmd = f"powershell -Command \"(Get-Item '{remote_path}').LastWriteTime = ([datetimeoffset]::FromUnixTimeSeconds({mtime_epoch})).DateTime\""
        run_ssh_cmd(user, host, set_mtime_cmd)
    else:
        run_ssh_cmd(user, host, f"touch -m -t {time.strftime('%Y%m%d%H%M.%S', time.localtime(mtime))} '{remote_path}'")

def resolve_remote_freeshow_dirs(user, host, remote_os):
    """
    Resolves everything needed to sync against one FreeShow target: its own
    app-data directory, its actual data root (read from ITS OWN settings.json
    dataPath, falling back to the local Documents/FreeShow default and to a
    network-mount-safe fallback), and the four folder paths derived from
    that root. Self-contained per target so this can be called once per
    target in a loop.
    """
    if remote_os == "windows":
        remote_app_data_dir = f"C:/Users/{user}/AppData/Roaming/FreeShow"
        default_docs_dir = f"C:/Users/{user}/Documents/FreeShow"
    elif remote_os == "linux":
        remote_app_data_dir = f"/home/{user}/.config/freeshow"
        default_docs_dir = f"/home/{user}/Documents/FreeShow"
    else:
        remote_app_data_dir = f"/Users/{user}/Library/Application Support/freeshow"
        default_docs_dir = f"/Users/{user}/Documents/FreeShow"

    local_temp_settings = f"/tmp/remote_settings_sync_{host.replace('.', '_')}.json"
    remote_docs_dir = default_docs_dir
    if sftp_transfer(user, host, local_temp_settings, f"{remote_app_data_dir}/settings.json", "get"):
        try:
            with open(local_temp_settings, 'r', encoding='utf-8') as f:
                remote_settings = json.load(f)
                remote_docs_dir = remote_settings.get("dataPath", default_docs_dir)
        except Exception as e:
            print(f"Warning: Failed to parse remote settings.json ({e}). Using default path.")
        finally:
            if os.path.exists(local_temp_settings):
                os.remove(local_temp_settings)
    else:
        print("Warning: Could not download remote settings.json. Using default path.")

    if is_network_mount(user, host, remote_os, remote_docs_dir):
        print(f"Detected network-mounted dataPath: {remote_docs_dir}. Using local fallback Documents directory for sync: {default_docs_dir}")
        remote_root_dir = default_docs_dir
    else:
        remote_root_dir = remote_docs_dir

    remote_shows_dir = f"{remote_root_dir}/Shows"
    remote_media_dir = f"{remote_root_dir}/Media"
    remote_bibles_dir = f"{remote_root_dir}/Bibles"
    # .fstemplate files live directly in the FreeShow data root, not a
    # dedicated subfolder.
    remote_templates_dir = remote_root_dir

    return remote_app_data_dir, remote_root_dir, remote_shows_dir, remote_media_dir, remote_bibles_dir, remote_templates_dir

def delete_remote_show_file(user, host, remote_os, remote_shows_dir, show_file):
    remote_file_path = f"{remote_shows_dir}/{show_file}"
    if remote_os == "windows":
        run_ssh_cmd(user, host, f"cmd.exe /c del /f /q \"{remote_file_path}\"")
    else:
        run_ssh_cmd(user, host, f"rm -f \"{remote_file_path}\"")

def remove_ids_from_remote_shows_index(user, host, remote_app_data_dir, ids):
    """Batched download-edit-upload of the remote FreeShow shows.json index,
    dropping every id in `ids` that's present. No-op if `ids` is empty."""
    ids = [i for i in ids if i]
    if not ids:
        return
    print(f"Bijwerken van remote shows.json voor {len(ids)} verwijderde shows...")
    local_temp_shows = f"/tmp/remote_shows_sync_{host.replace('.', '_')}.json"
    if os.path.exists(local_temp_shows):
        os.remove(local_temp_shows)
    if sftp_transfer(user, host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "get"):
        try:
            with open(local_temp_shows, 'r', encoding='utf-8') as f:
                shows_json_data = json.load(f)
            modified_index = False
            for s_id in ids:
                if s_id in shows_json_data:
                    del shows_json_data[s_id]
                    modified_index = True
            if modified_index:
                with open(local_temp_shows, 'w', encoding='utf-8') as f:
                    json.dump(shows_json_data, f)
                sftp_transfer(user, host, local_temp_shows, f"{remote_app_data_dir}/shows.json", "put")
                print("Remote shows.json succesvol bijgewerkt.")
        except Exception as e:
            print(f"Fout bij bewerken van shows.json: {e}")
        finally:
            if os.path.exists(local_temp_shows):
                os.remove(local_temp_shows)

def sync_shows_folder(label, nas_shows_dir, remote_shows_dir, user, host, remote_os,
                       remote_app_data_dir, shows_state, now_ts, one_week_secs,
                       delete_all_scriptures, expired_show_files):
    """
    Two-way, deletion-safe sync of the Shows folder for one target,
    including scripture-expiry interception on copy and remote shows.json
    index upkeep. Same self-contained contract as sync_simple_folder: does
    its own NAS/remote scan, returns (new_shows_state, stats).

    `expired_show_files` is the [(show_file, show_id), ...] list already
    decided and removed from the NAS by STAP 1 (the NAS is and stays the
    single source of truth for "is this expired"). This function just fans
    that decision out to this target's remote - unconditionally, so it
    works even the first time a target has no prior state yet - on top of
    its own state-based Case A/B manual-deletion detection, which is what
    actually needs `apply_safety_guard`.
    """
    print(f"\n--- SYNC: {label} (Shows) ---")
    ids_to_remove = set()

    for show_file, show_id in expired_show_files:
        delete_remote_show_file(user, host, remote_os, remote_shows_dir, show_file)
        if show_id:
            ids_to_remove.add(show_id)

    nas_files = {}
    for f in glob.glob(os.path.join(nas_shows_dir, "*.show")):
        name = os.path.basename(f)
        nas_files[name] = {"path": f, "mtime": os.path.getmtime(f), "size": os.path.getsize(f)}

    remote_files = {
        name: info for name, info in list_remote_files(user, host, remote_os, remote_shows_dir).items()
        if name.lower().endswith(".show")
    }

    print(f"[{label}] Aantal shows op NAS: {len(nas_files)}, aantal op doel: {len(remote_files)}")

    if shows_state:
        print(f"[{label}] --- OPSPOREN VAN HANDMATIGE VERWIJDERINGEN ---")
        deletions_on_remote = []
        deletions_on_nas = []
        show_ids_by_name = {}
        for name, state_info in list(shows_state.items()):
            if name not in nas_files:
                print(f"[{label}] Show '{name}' handmatig verwijderd van NAS. Propageren naar doel...")
                deletions_on_remote.append(name)
                show_ids_by_name[name] = state_info.get("id")
            elif name not in remote_files:
                print(f"[{label}] Show '{name}' handmatig verwijderd van doel. Propageren naar NAS...")
                deletions_on_nas.append(name)
                show_ids_by_name[name] = state_info.get("id")

        deletions_on_nas, deletions_on_remote, _tripped = apply_safety_guard(
            f"{label} - Shows", deletions_on_nas, deletions_on_remote, len(shows_state)
        )

        for name in deletions_on_remote:
            if name in remote_files:
                del remote_files[name]
            if show_ids_by_name.get(name):
                ids_to_remove.add(show_ids_by_name[name])
        for name in deletions_on_nas:
            if name in nas_files:
                del nas_files[name]
            if show_ids_by_name.get(name):
                ids_to_remove.add(show_ids_by_name[name])

        for name in deletions_on_nas:
            dest_path = os.path.join(nas_shows_dir, name)
            if os.path.exists(dest_path):
                try:
                    os.remove(dest_path)
                    print(f"[{label}] Verwijderd van NAS: {name}")
                except Exception as e:
                    print(f"[{label}] Fout bij verwijderen van NAS {name}: {e}")

        for name in deletions_on_remote:
            print(f"[{label}] Verwijderen van doel: {name}...")
            delete_remote_show_file(user, host, remote_os, remote_shows_dir, name)

    # Doel -> NAS (nieuw of nieuwer op doel)
    copied_to_nas = 0
    for name, r_info in remote_files.items():
        if name not in nas_files:
            print(f"[{label}] Nieuwe show gedetecteerd op doel: '{name}'. Analyseren...")
            temp_dest = f"/tmp/temp_sync_{host.replace('.', '_')}_{name}"
            if os.path.exists(temp_dest):
                os.remove(temp_dest)

            if sftp_transfer(user, host, temp_dest, f"{remote_shows_dir}/{name}", "get"):
                is_scripture = False
                try:
                    with open(temp_dest, 'r', encoding='utf-8') as f:
                        show_data = json.load(f)
                        if isinstance(show_data, list) and len(show_data) > 1:
                            is_scripture = show_data[1].get("category") == "scripture"
                except Exception as e:
                    print(f"[{label}] Error checking category of remote show {name}: {e}")

                if is_scripture and (delete_all_scriptures or (now_ts - r_info["mtime"] > one_week_secs)):
                    print(f"[{label}] Intercepted remote scripture '{name}' (expired/wipe). Deleting from doel...")
                    delete_remote_show_file(user, host, remote_os, remote_shows_dir, name)
                    show_id = get_show_id_from_file(temp_dest)
                    if show_id:
                        ids_to_remove.add(show_id)
                    if os.path.exists(temp_dest):
                        os.remove(temp_dest)
                else:
                    dest_path = os.path.join(nas_shows_dir, name)
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                    shutil.move(temp_dest, dest_path)
                    _safe_chmod(dest_path)
                    _safe_utime(dest_path, r_info["mtime"])
                    copied_to_nas += 1
        else:
            n_info = nas_files[name]
            if r_info["mtime"] - n_info["mtime"] > 2.0:
                print(f"[{label}] Nieuwere versie gedetecteerd op doel: '{name}'. Analyseren...")
                temp_dest = f"/tmp/temp_sync_{host.replace('.', '_')}_{name}"
                if os.path.exists(temp_dest):
                    os.remove(temp_dest)

                if sftp_transfer(user, host, temp_dest, f"{remote_shows_dir}/{name}", "get"):
                    is_scripture = False
                    try:
                        with open(temp_dest, 'r', encoding='utf-8') as f:
                            show_data = json.load(f)
                            if isinstance(show_data, list) and len(show_data) > 1:
                                is_scripture = show_data[1].get("category") == "scripture"
                    except Exception as e:
                        print(f"[{label}] Error checking category of remote show {name}: {e}")

                    if is_scripture and (delete_all_scriptures or (now_ts - r_info["mtime"] > one_week_secs)):
                        print(f"[{label}] Intercepted newer remote scripture '{name}' (expired/wipe). Deleting from both...")
                        delete_remote_show_file(user, host, remote_os, remote_shows_dir, name)
                        dest_path = os.path.join(nas_shows_dir, name)
                        if os.path.exists(dest_path):
                            os.remove(dest_path)
                        show_id = get_show_id_from_file(temp_dest)
                        if show_id:
                            ids_to_remove.add(show_id)
                        if os.path.exists(temp_dest):
                            os.remove(temp_dest)
                    else:
                        dest_path = os.path.join(nas_shows_dir, name)
                        if os.path.exists(dest_path):
                            os.remove(dest_path)
                        shutil.move(temp_dest, dest_path)
                        _safe_chmod(dest_path)
                        _safe_utime(dest_path, r_info["mtime"])
                        copied_to_nas += 1

    # NAS -> doel (nieuw of nieuwer op NAS)
    copied_to_remote = 0
    for name, n_info in nas_files.items():
        remote_path = f"{remote_shows_dir}/{name}"
        if name not in remote_files:
            print(f"[{label}] Nieuwe show gedetecteerd op NAS: '{name}'. Kopieren naar doel...")
            if sftp_transfer(user, host, n_info["path"], remote_path, "put"):
                _touch_remote(user, host, remote_os, remote_path, n_info["mtime"])
                copied_to_remote += 1
        else:
            r_info = remote_files[name]
            if n_info["mtime"] - r_info["mtime"] > 2.0:
                print(f"[{label}] Nieuwere versie gedetecteerd op NAS: '{name}'. Updaten op doel...")
                if sftp_transfer(user, host, n_info["path"], remote_path, "put"):
                    _touch_remote(user, host, remote_os, remote_path, n_info["mtime"])
                    copied_to_remote += 1

    print(f"[{label}] Shows sync afgerond. Kopieren naar NAS: {copied_to_nas}, Kopieren naar doel: {copied_to_remote}")

    remove_ids_from_remote_shows_index(user, host, remote_app_data_dir, list(ids_to_remove))

    # Fresh rescan for the saved state - an aborted/guarded deletion must
    # never be "forgotten" despite the file still existing.
    new_shows_state = {}
    for show_path in glob.glob(os.path.join(nas_shows_dir, "*.show")):
        name = os.path.basename(show_path)
        show_id = get_show_id_from_file(show_path)
        new_shows_state[name] = {
            "mtime": os.path.getmtime(show_path),
            "size": os.path.getsize(show_path),
            "id": show_id
        }

    return new_shows_state, {"copied_to_nas": copied_to_nas, "copied_to_remote": copied_to_remote}

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

    skip_media = "--skip-media" in sys.argv
    if skip_media:
        print("SKIP-MEDIA MODE: Media-map wordt deze run overgeslagen (voor snellere, frequentere syncs).")

    skip_additional_targets = "--skip-additional-targets" in sys.argv
    if skip_additional_targets:
        print("SKIP-ADDITIONAL-TARGETS MODE: Alleen het hoofd-doel wordt deze run gesynchroniseerd.")

    # 1. Configuration Check
    mac_user = settings.get("sshUser", "admin")
    mac_host = settings.get("freeShowHost", "192.168.2.101")
    if mac_host in ["localhost", "127.0.0.1", None]:
        mac_host = "192.168.2.101"

    nas_freeshow_path = settings.get("freeshowPath", "/volume1/Beamer/FreeShow").rstrip("/")
    nas_shows_dir = os.path.join(nas_freeshow_path, "Shows")
    nas_media_dir = os.path.join(nas_freeshow_path, "Media")
    nas_bibles_dir = os.path.join(nas_freeshow_path, "Bibles")

    if not os.path.exists(nas_shows_dir):
        print(f"ERROR: NAS Shows directory does not exist: {nas_shows_dir}")
        sys.exit(1)

    print(f"Hoofd-doel: {mac_user}@{mac_host}")
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
        print("Note: These will be deleted from remote targets during the next full sync.")
        sys.exit(0)

    # Build the target list: the primary Beamer PC (unchanged config/role,
    # keeps all power-automation/shutdown), plus every enabled entry from
    # freeshowAdditionalTargets (e.g. a Sunday-school PC) - those only ever
    # get the catalog sync, no power automation, no project-import.
    targets = [{
        "key": "primary",
        "label": f"Beamer PC ({mac_host})",
        "host": mac_host,
        "user": mac_user,
        "is_primary": True,
    }]
    for t in (settings.get("freeshowAdditionalTargets") or []):
        if t.get("enabled", True) is False:
            continue
        host = (t.get("host") or "").strip()
        if not host:
            continue
        targets.append({
            "key": t.get("id") or f"target_{host}",
            "label": t.get("name") or host,
            "host": host,
            "user": (t.get("sshUser") or "").strip() or mac_user,
            "is_primary": False,
        })

    if len(targets) > 1:
        print(f"Doelen deze run: {', '.join(t['label'] for t in targets)}")

    _write_sync_status(
        SCRIPT_DIR,
        running=True,
        started_at=time.strftime('%Y-%m-%d %H:%M:%S'),
        finished_at=None,
        success=None,
        error=None,
        pid=os.getpid(),
        targets=[{"key": t["key"], "label": t["label"], "status": "pending"} for t in targets],
    )

    # 2. Power Management check (hoofd-doel only - extra doelen worden pas
    # bereikbaarheid-gecheckt vlak voor hun eigen sync-stap, geen wek-poging)
    primary_reachable = True
    is_pc_online = test_ssh(mac_user, mac_host)

    if not is_pc_online:
        print("Beamer PC is offline. Initiating remote startup sequence...")

        plugs = settings.get("tuyaPlugs", [])
        beamer_plug = next((p for p in plugs if p.get("id") == "plug_beamer"), None)

        if beamer_plug:
            print("[Power] Turning ON smart plug 'plug_beamer'...")
            subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "on", "plug_beamer"])

            if wait_for_ssh(mac_user, mac_host):
                print("[Power] Beamer PC successfully started!")
                time.sleep(10)
            else:
                print("WAARSCHUWING: Beamer PC reageerde niet na het aanzetten van de stekker. "
                      "Hoofd-doel wordt deze run overgeslagen; extra doelen (indien geconfigureerd) gaan gewoon door.")
                primary_reachable = False
        else:
            print("WAARSCHUWING: Beamer PC is offline en 'plug_beamer' is niet geconfigureerd. "
                  "Hoofd-doel wordt deze run overgeslagen; extra doelen (indien geconfigureerd) gaan gewoon door.")
            primary_reachable = False
    else:
        print("Beamer PC is already online. Skipping startup sequence.")

    # Load previous sync state. Migrates in two steps if needed:
    # 1. oldest flat {filename: info} shape (Shows only) -> {"shows": ...}
    # 2. pre-multi-target shape {"shows":..,"media":..,...} -> wrapped as
    #    {"targets": {"primary": <that same dict, unmodified>}} - a pure
    #    wrap, never a reset, so the primary's known-file counts (what
    #    apply_safety_guard compares deletion batches against) survive the
    #    upgrade byte-for-byte.
    state_file = os.path.join(SCRIPT_DIR, "data", "sync_state.json")
    if not os.path.exists(os.path.dirname(state_file)):
        os.makedirs(os.path.dirname(state_file), exist_ok=True)

    sync_state = {}
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                loaded_state = json.load(f)
            if loaded_state and "shows" not in loaded_state and "targets" not in loaded_state:
                print("Oude platte sync_state.json gedetecteerd (alleen Shows) - migreren naar nieuwe structuur.")
                loaded_state = {"shows": loaded_state}
            if loaded_state and "targets" not in loaded_state:
                print("Sync state van vóór meerdere-doelen-ondersteuning gedetecteerd - wikkelen als 'primary' doel.")
                loaded_state = {"targets": {"primary": loaded_state}}
            sync_state = loaded_state or {}
        except Exception as e:
            print(f"Warning: Failed to load sync state ({e}). Starting fresh.")

    sync_state.setdefault("targets", {})
    for t in targets:
        t_state = sync_state["targets"].setdefault(t["key"], {})
        for folder in ("shows", "media", "bibles", "templates"):
            t_state.setdefault(folder, {})

    print(f"Vorige sync state geladen. Shows in state voor hoofd-doel: {len(sync_state['targets'].get('primary', {}).get('shows', {}))}")

    # 3. STAP 1: Oude Bijbelteksten (Scriptures) opschonen (> 7 dagen)
    # De NAS blijft de enige bron van waarheid over wat verlopen is - dit
    # draait één keer, ongeacht hoeveel doelen er zijn. De beslissing (welke
    # bestanden) wordt hierna per doel gepropageerd.
    print("\n--- STAP 1: SCRIPTURE OPSCHONING (> 7 dagen oud) ---")
    nas_shows = glob.glob(os.path.join(nas_shows_dir, "*.show"))
    expired_show_files = []  # [(show_file, show_id), ...]
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
                        os.remove(show_path)
                        expired_show_files.append((show_file, show_id))
        except Exception as e:
            print(f"Fout bij verwerken van show {show_file} voor cleanup: {e}")

    if expired_show_files:
        print(f"{len(expired_show_files)} verlopen bijbeltekst(en) van de NAS verwijderd; wordt per doel gepropageerd.")

    # 4. STAP 2+3 per doel: Shows, Bibles, Templates, (optioneel) Media
    for target in targets:
        label = target["label"]

        if target["is_primary"]:
            if not primary_reachable:
                print(f"\n=== [{label}] Overgeslagen - hoofd-doel niet bereikbaar deze run ===")
                _update_target_status(SCRIPT_DIR, target["key"], "skipped")
                continue
        else:
            if skip_additional_targets:
                _update_target_status(SCRIPT_DIR, target["key"], "skipped")
                continue
            if not test_ssh(target["user"], target["host"]):
                print(f"\n=== [{label}] Overgeslagen - niet bereikbaar (offline of onjuist IP) ===")
                _update_target_status(SCRIPT_DIR, target["key"], "skipped")
                continue

        print(f"\n=== SYNC DOEL: {label} ({target['user']}@{target['host']}) ===")
        _update_target_status(SCRIPT_DIR, target["key"], "running")
        try:
            remote_os = detect_remote_os(target["user"], target["host"])
            print(f"[{label}] Remote OS: {remote_os}")

            (remote_app_data_dir, remote_root_dir, remote_shows_dir,
             remote_media_dir, remote_bibles_dir, remote_templates_dir) = resolve_remote_freeshow_dirs(
                target["user"], target["host"], remote_os
            )
            print(f"[{label}] Remote data root: {remote_root_dir}")

            t_state = sync_state["targets"][target["key"]]

            t_state["shows"], _shows_stats = sync_shows_folder(
                label, nas_shows_dir, remote_shows_dir, target["user"], target["host"], remote_os,
                remote_app_data_dir, t_state["shows"], now_ts, one_week_secs, delete_all_scriptures,
                expired_show_files
            )

            t_state["bibles"], _ = sync_simple_folder(
                f"{label} - Bibles", nas_bibles_dir, remote_bibles_dir, target["user"], target["host"], remote_os,
                t_state["bibles"], extensions={".fsb"}
            )
            t_state["templates"], _ = sync_simple_folder(
                f"{label} - Templates", nas_freeshow_path, remote_templates_dir, target["user"], target["host"], remote_os,
                t_state["templates"], extensions={".fstemplate"}
            )
            if skip_media:
                print(f"\n--- SYNC: {label} - Media --- OVERGESLAGEN (--skip-media)")
            else:
                t_state["media"], _ = sync_simple_folder(
                    f"{label} - Media", nas_media_dir, remote_media_dir, target["user"], target["host"], remote_os,
                    t_state["media"], exclude_names={".DS_Store", "Thumbs.db", "desktop.ini"}
                )

            sync_state["targets"][target["key"]] = t_state

            # STAP 4 (afsluiten/stroom uit) blijft exclusief voor het hoofd-doel.
            if target["is_primary"]:
                if keep_on:
                    print("\n--- STAP 4: AFSLUITEN OVERGESLAGEN (--keep-on) ---")
                else:
                    print("\n--- STAP 4: BEAMER PC NETJES AFSLUITEN ---")
                    print(f"Sturen van afsluitcommando naar Beamer PC ({remote_os})...")
                    if remote_os == "windows":
                        run_ssh_cmd(target["user"], target["host"], "shutdown /s /f /t 0")
                    elif remote_os == "linux":
                        run_ssh_cmd(target["user"], target["host"], "shutdown -h now")
                    else:
                        run_ssh_cmd(target["user"], target["host"], "osascript -e 'tell application \"System Events\" to shut down'")
                    print("Wachten op 15 seconden voor het veilig afsluiten...")
                    time.sleep(15)
                    print("[Power] Uitschakelen van smart plug 'plug_beamer'...")
                    subprocess.run(["python3", os.path.join(SCRIPT_DIR, "control_plug.py"), "off", "plug_beamer"])
                    print("[Power] Stroom succesvol afgesloten.")

            _update_target_status(SCRIPT_DIR, target["key"], "done")
        except Exception as e:
            print(f"[{label}] FOUT tijdens sync: {e} - doorgaan met volgende doel.")
            _update_target_status(SCRIPT_DIR, target["key"], "error")

    # Save the updated sync state
    try:
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(sync_state, f, indent=4)
        print("\nSynchronisatiestate succesvol bijgewerkt en opgeslagen.")
    except Exception as e:
        print(f"ERROR: Failed to save sync state file: {e}")

    _write_sync_status(
        SCRIPT_DIR,
        running=False,
        finished_at=time.strftime('%Y-%m-%d %H:%M:%S'),
        success=True,
        error=None,
    )

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] === FREESHOW SYNC & CLEANUP VOLTOOID ===")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Safety net: if main() got far enough to mark itself "running" and
        # then crashed somewhere not already caught by its own per-target
        # try/except (e.g. during STAP 1 or state-file handling), make sure
        # the status file doesn't stay stuck on "running" forever - the two
        # early sys.exit() paths in main() run before that point and are
        # deliberately not caught here (SystemExit isn't an Exception).
        _write_sync_status(
            os.path.dirname(os.path.abspath(__file__)),
            running=False,
            finished_at=time.strftime('%Y-%m-%d %H:%M:%S'),
            success=False,
            error=str(e),
        )
        raise
