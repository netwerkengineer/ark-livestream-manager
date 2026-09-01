"""
Shared append-only activity logger for the admin-only Activiteitenlog in
the app - written to by sync_and_cleanup_freeshow.py and
tuya_http_server.py, read by src/lib/activityLog.ts (same file, same JSON
Lines format) via the app's /api/activity-log route.

Trimmed automatically once it grows past a size threshold, same policy as
the TypeScript side - keeps disk usage bounded without OS-level log
rotation. A rewrite landing at the same moment as a write from the Next.js
side is a low-probability, low-stakes race for what's just an admin
convenience log, so this doesn't bother with file locking either.
"""
import json
import os
import time

TRIM_THRESHOLD_BYTES = 2 * 1024 * 1024
MAX_ENTRIES = 5000


def _log_path():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "data", "activity_log.jsonl"),
        "/app/data/activity_log.jsonl",
    ]
    for c in candidates:
        if os.path.isdir(os.path.dirname(c)):
            return c
    return candidates[0]


def _safe_chmod(path):
    # World-writable, matching sync_and_cleanup_freeshow.py's own
    # _safe_chmod - this file is written from both this container
    # (tuya-control) and the main app container, under different users, so
    # whichever side creates it first must leave it open for the other.
    # Best effort only: never let a chmod failure break the actual log write.
    try:
        os.chmod(path, 0o666)
    except OSError:
        pass


def _trim_if_needed(path):
    try:
        if os.path.getsize(path) <= TRIM_THRESHOLD_BYTES:
            return
        with open(path, "r", encoding="utf-8") as f:
            lines = [l for l in f.read().split("\n") if l]
        trimmed = lines[-MAX_ENTRIES:]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(trimmed) + "\n")
        _safe_chmod(path)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[ActivityLog] Kon logboek niet inkorten: {e}")


def log_activity(category, message, details=None):
    """category: 'sync' | 'plug' | 'led' | 'error' | 'settings' | 'system'"""
    try:
        path = _log_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z",
            "category": category,
            "message": message,
        }
        if details:
            entry["details"] = details
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        _safe_chmod(path)
        _trim_if_needed(path)
    except Exception as e:
        print(f"[ActivityLog] Kon gebeurtenis niet wegschrijven: {e}")
