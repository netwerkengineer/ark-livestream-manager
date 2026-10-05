import fs from 'fs';
import path from 'path';
import { logActivity } from './activityLog';
import { sendOpsAlertEmail } from './mailer';

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
  warnedThisDay?: boolean;
  // Per caller + endpoint, so "who used 8000 units?" has an answer: the
  // total alone can't tell a runaway poll from normal use.
  breakdown?: Record<string, { calls: number; units: number }>;
}

// Fire once per quota-day the first time estimated usage crosses this -
// the point of tracking usage at all is to catch a runaway consumer (e.g.
// the LED panel's YouTube poll, which alone used ~86% of a day's quota
// before its interval was fixed) before it actually blocks functionality,
// not just to explain it afterwards via the reactive quotaExceeded alert
// already sent elsewhere (thumbnailSync.ts).
const WARN_THRESHOLD_PERCENT = 80;

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

function breakdownKey(url: string, method: string, source?: string): string {
  let resource = "onbekend";
  try {
    const u = new URL(url);
    resource = u.pathname.replace(/^\/youtube\/v3\//, "");
    const status = u.searchParams.get("broadcastStatus");
    if (status) resource += `[${status}]`;
  } catch {}
  return `${source || "overig"} | ${(method || "GET").toUpperCase()} ${resource}`;
}

function topConsumers(state: QuotaState, limit = 5): string {
  const rows = Object.entries(state.breakdown || {})
    .sort((a, b) => b[1].units - a[1].units)
    .slice(0, limit);
  if (rows.length === 0) return "(geen uitsplitsing beschikbaar)";
  return rows.map(([key, v]) => `- ${key}: ${v.calls}x, ${v.units} units`).join("\n");
}

export function recordYoutubeQuotaUsage(url: string, method: string, source?: string) {
  const state = readState();
  const cost = estimateCost(url, method);
  state.unitsUsed += cost;

  const key = breakdownKey(url, method, source);
  state.breakdown = state.breakdown || {};
  const entry = state.breakdown[key] || { calls: 0, units: 0 };
  entry.calls += 1;
  entry.units += cost;
  state.breakdown[key] = entry;

  const percentUsed = (state.unitsUsed / ASSUMED_DAILY_LIMIT) * 100;
  if (percentUsed >= WARN_THRESHOLD_PERCENT && !state.warnedThisDay) {
    state.warnedThisDay = true;
    const message = `YouTube API-quota (geschat) staat op ${Math.round(percentUsed)}% van het dagelijkse limiet (${state.unitsUsed}/${ASSUMED_DAILY_LIMIT} units, ${state.date}).`;
    logActivity('error', `${message}\nGrootste verbruikers:\n${topConsumers(state, 3)}`);
    sendOpsAlertEmail(
      'YouTube API-quota bijna op',
      `${message}\n\nGrootste verbruikers vandaag:\n${topConsumers(state)}\n\nBij 100% gaan YouTube-acties (thumbnail-sync, planner, live-status) tijdelijk mislukken tot het quotum rond 9:00 's ochtends (Nederlandse tijd, middernacht Pacific) automatisch reset.`,
      { key: 'youtube-quota-warning' }
    ).catch(() => {});
  }

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
