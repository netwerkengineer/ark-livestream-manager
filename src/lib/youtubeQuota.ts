import fs from 'fs';
import path from 'path';

const QUOTA_FILE = path.join(process.cwd(), 'data', 'youtube_quota.json');

// Google's default free-tier YouTube Data API v3 quota. If this project's
// quota was ever raised, this makes the warning fire more conservatively
// (looks "more used" than it really is) rather than not fire at all -
// there's no API to read the project's actual granted quota or real-time
// usage from here, only the Google Cloud Console shows that.
const ASSUMED_DAILY_LIMIT = 10000;

interface QuotaState {
  date: string; // Pacific-time quota day (YYYY-MM-DD), matching Google's actual daily reset boundary
  unitsUsed: number;
}

function pacificDateKey(): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function readState(): QuotaState {
  try {
    const raw = fs.readFileSync(QUOTA_FILE, 'utf-8');
    const state = JSON.parse(raw) as QuotaState;
    if (state.date === pacificDateKey()) return state;
  } catch {}
  return { date: pacificDateKey(), unitsUsed: 0 };
}

function writeState(state: QuotaState) {
  try {
    fs.mkdirSync(path.dirname(QUOTA_FILE), { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(state));
  } catch (err) {
    console.error('[YouTube Quota] Failed to persist usage:', err);
  }
}

// Per-call cost inferred from the HTTP method/endpoint, matching the YouTube
// Data API v3's documented per-method quota costs (list=1, insert/update/
// delete/bind/thumbnails.set=50, search=100). This is an estimate - Google
// doesn't expose real quota consumption through the Data API itself - but
// close enough to warn before actually hitting the daily limit rather than
// only finding out via a quotaExceeded error, which is what happened before.
function estimateCost(url: string, method: string): number {
  const m = (method || 'GET').toUpperCase();
  if (url.includes('/search')) return 100;
  if (m === 'GET') return 1;
  return 50;
}

export function recordYoutubeQuotaUsage(url: string, method: string) {
  const state = readState();
  state.unitsUsed += estimateCost(url, method);
  writeState(state);
}

export interface YoutubeQuotaStatus {
  date: string;
  unitsUsed: number;
  estimatedLimit: number;
  percentUsed: number;
}

export function getYoutubeQuotaStatus(): YoutubeQuotaStatus {
  const state = readState();
  return {
    date: state.date,
    unitsUsed: state.unitsUsed,
    estimatedLimit: ASSUMED_DAILY_LIMIT,
    percentUsed: Math.min(100, Math.round((state.unitsUsed / ASSUMED_DAILY_LIMIT) * 100)),
  };
}
