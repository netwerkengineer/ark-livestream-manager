import { getSettings } from './settingsStore';

// Shared by every feature that polls YouTube's live status (the LED panel's
// obsManager.ts, and the public live-status API the ArkChurch website
// polls) - services are always Sunday ~10:30-12:00 Amsterdam time, so
// outside this window (configurable in Instellingen -> Verbindingen) there's
// never anything to find and polling only burns API quota. A holiday
// service on another day (Kerstavond, Goede Vrijdag, ...) won't auto-detect
// here - the LED panel still has its manual test button on the Monitor page
// for that, and the website falls back to the manual "live" switch in the
// beheerpaneel.
function parseHHMM(value: string | undefined, fallback: string): number {
  const [h, m] = (value || fallback).split(':').map(n => parseInt(n, 10));
  const hours = Number.isFinite(h) ? h : 0;
  const minutes = Number.isFinite(m) ? m : 0;
  return hours * 60 + minutes;
}

export function isWithinSundayServiceWindow(settings: ReturnType<typeof getSettings>): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const minutesSinceMidnight = hour * 60 + minute;
  const windowStart = parseHHMM(settings.ledYoutubePollStartTime, '10:00');
  const windowEnd = parseHHMM(settings.ledYoutubePollEndTime, '12:30');
  return weekday === 'Sun' && minutesSinceMidnight >= windowStart && minutesSinceMidnight <= windowEnd;
}
