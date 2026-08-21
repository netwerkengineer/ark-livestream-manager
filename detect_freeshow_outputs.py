#!/usr/bin/env python3
"""
Looks up the output IDs FreeShow currently uses on whichever machine runs it
for this environment (settings.freeShowHost) - output IDs aren't shown
anywhere in FreeShow's own UI and are local to that one machine, so this is
what backs the "Automatisch opzoeken" button next to the livestream-output
setting in the app's Settings panel. Prints a single JSON line to stdout,
never touches anything - read-only.
"""
import json
import subprocess
import sys
import base64
import os
import shutil

# Same key-permission fix as sync_and_cleanup_freeshow.py - the app's own
# SSH key gets bind-mounted into the container at a path/permission SSH
# often refuses to use directly (e.g. 0644/0666 from the host side), so
# every ssh call here copies it to a fresh 0600 temp file first instead.
def run_command_with_key(*args, **kwargs):
    cmd_list = args[0]
    if isinstance(cmd_list, list) and len(cmd_list) > 0 and cmd_list[0] == "ssh":
        candidates = [
            "/app/data/id_ed25519",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "id_ed25519"),
            "/volume1/docker/ark-livestream-manager/data/id_ed25519",
        ]
        ssh_key_args = []
        for c in candidates:
            if os.path.exists(c):
                tmp_key = "/tmp/id_ed25519_temp_detect"
                try:
                    shutil.copy2(c, tmp_key)
                    os.chmod(tmp_key, 0o600)
                    ssh_key_args = ["-i", tmp_key]
                    break
                except Exception:
                    pass
        new_cmd = ["ssh"] + ssh_key_args + ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null"]
        i = 1
        while i < len(cmd_list):
            item = cmd_list[i]
            if item == "-o" and i + 1 < len(cmd_list) and ("StrictHostKeyChecking" in cmd_list[i + 1] or "UserKnownHostsFile" in cmd_list[i + 1]):
                i += 2
                continue
            new_cmd.append(item)
            i += 1
        args = (new_cmd,) + args[1:]
    return original_run(*args, **kwargs)


original_run = subprocess.run
subprocess.run = run_command_with_key


def get_settings():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "settings.json"),
        "/volume1/docker/ark-livestream-manager/data/settings.json",
        "/app/data/settings.json",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def detect_remote_os(user, host):
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "cmd.exe /c echo windows"],
        capture_output=True,
    )
    if b"windows" in res.stdout.lower():
        return "windows"
    return "macos"


def run_ssh_cmd(user, host, cmd):
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", cmd],
        capture_output=True,
    )
    return res.stdout.decode("utf-8", errors="replace"), res.returncode


def run_ps_script(user, host, script):
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("utf-8")
    res = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", f"{user}@{host}", "powershell", "-EncodedCommand", encoded],
        capture_output=True,
    )
    return res.stdout.decode("utf-8", errors="replace"), res.returncode


def main():
    settings = get_settings()
    user = settings.get("sshUser", "admin")
    host = settings.get("freeShowHost", "")
    if not host or host in ("localhost", "127.0.0.1"):
        print(json.dumps({"error": "Geen freeShowHost ingesteld in de instellingen."}))
        return

    remote_os = detect_remote_os(user, host)
    if remote_os == "windows":
        ps = (
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "Get-Content -Raw \"$env:APPDATA\\FreeShow\\settings.json\""
        )
        content, code = run_ps_script(user, host, ps)
    else:
        content, code = run_ssh_cmd(
            user, host,
            "cat \"$HOME/Library/Application Support/freeshow/settings.json\""
        )

    if code != 0 or not content.strip():
        print(json.dumps({"error": f"Kon settings.json niet lezen op {host} ({remote_os}) - staat FreeShow daar aan en is de PC bereikbaar?"}))
        return

    try:
        data = json.loads(content)
    except Exception as e:
        print(json.dumps({"error": f"Kon settings.json van {host} niet lezen als JSON: {e}"}))
        return

    outputs = data.get("outputs", {})
    results = [{"id": oid, "name": o.get("name") or "(naamloos)"} for oid, o in outputs.items()]
    print(json.dumps({"host": host, "outputs": results}))


if __name__ == "__main__":
    main()
