import fs from 'node:fs';
import path from 'node:path';

// The own setlist for the Tracks tab with REAPER: a list of projects on the track computer that is not tied to a
// service from the Planner. Kept on the server so every screen (operator, stage, phone) shows the same list.

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'trackOwnSetlist.json');

export interface OwnSetlist {
  active: boolean;     // the Tracks tab shows this list instead of a service
  paths: string[];     // project paths on the track computer, in order
}

export function getOwnSetlist(): OwnSetlist {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return { active: !!j.active, paths: Array.isArray(j.paths) ? j.paths.filter((p: unknown): p is string => typeof p === 'string') : [] };
  } catch {
    return { active: false, paths: [] };
  }
}

export function saveOwnSetlist(next: OwnSetlist) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
}
