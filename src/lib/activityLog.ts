import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'activity_log.jsonl');

// Trimmed whenever the file grows past this size, down to MAX_ENTRIES most
// recent lines - keeps disk usage bounded without needing OS-level log
// rotation (sync_cleanup.log has no such cap and has grown past 2MB).
const TRIM_THRESHOLD_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;

export type ActivityCategory = 'sync' | 'plug' | 'led' | 'error' | 'settings' | 'system';

export interface ActivityEntry {
  ts: string;
  category: ActivityCategory;
  message: string;
  details?: Record<string, unknown>;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// World-writable, matching sync_and_cleanup_freeshow.py's own
// _safe_chmod - this file is written from both this container and the
// separate tuya-control container (a different user), so whichever side
// creates it first must leave it open for the other. Without this, the
// Python side hits a hard "Permission denied" the moment it tries to
// append to a file this container already created with default (owner-only)
// permissions. Best effort only: never let a chmod failure break the
// actual log write.
function safeChmod(target: string) {
  try {
    fs.chmodSync(target, 0o666);
  } catch {
    // ignore
  }
}

// Rewriting the whole file is only done occasionally (once the file passes
// the size threshold), so a concurrent append from the Python side landing
// mid-rewrite is a low-probability, low-stakes race for what's just an
// admin convenience log - not worth a locking mechanism over.
function trimIfNeeded() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size <= TRIM_THRESHOLD_BYTES) return;
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const trimmed = lines.slice(-MAX_ENTRIES);
    fs.writeFileSync(LOG_FILE, trimmed.join('\n') + '\n');
    safeChmod(LOG_FILE);
  } catch {
    // File doesn't exist yet, or a transient read/write error - next write
    // will just create/append normally.
  }
}

export function logActivity(category: ActivityCategory, message: string, details?: Record<string, unknown>) {
  try {
    ensureDataDir();
    const entry: ActivityEntry = { ts: new Date().toISOString(), category, message, ...(details ? { details } : {}) };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    safeChmod(LOG_FILE);
    trimIfNeeded();
  } catch (e) {
    console.error('[ActivityLog] Kon gebeurtenis niet wegschrijven:', e);
  }
}

// Newest first. `before` (an ISO timestamp) paginates further back in time.
export function readActivity(opts: { limit?: number; category?: ActivityCategory; before?: string } = {}): ActivityEntry[] {
  const limit = opts.limit ?? 100;
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const entries: ActivityEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip a corrupted line rather than failing the whole read.
      }
    }
    entries.reverse();
    let filtered = entries;
    if (opts.category) filtered = filtered.filter(e => e.category === opts.category);
    if (opts.before) filtered = filtered.filter(e => e.ts < opts.before!);
    return filtered.slice(0, limit);
  } catch (e) {
    console.error('[ActivityLog] Kon logboek niet lezen:', e);
    return [];
  }
}
