// Same fader law as the X32 (0 dB at 3/4 travel, +10 dB at the top), so a
// fader position here means the same as on the desk the team already knows.
export function faderToDb(f: number): number {
  if (f <= 0) return -Infinity;
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  return f * 480 - 90;
}

export function dbToFader(db: number): number {
  if (db >= 10) return 1;
  if (db >= -10) return (db + 30) / 40;
  if (db >= -30) return (db + 50) / 80;
  if (db >= -60) return (db + 70) / 160;
  if (db > -90) return (db + 90) / 480;
  return 0;
}

export const UNITY = dbToFader(0);

export const volumeToFader = (vol: number) => (vol <= 0 ? 0 : dbToFader(20 * Math.log10(vol)));

export const faderToVolume = (f: number) => {
  const db = faderToDb(f);
  return db === -Infinity || db <= -90 ? 0 : Math.pow(10, db / 20);
};

export function formatDb(f: number): string {
  const db = faderToDb(f);
  if (db === -Infinity || db <= -89.5) return "-∞";
  return (db > 0 ? "+" : "") + db.toFixed(1);
}

// -60 dB .. +6 dB over the meter height
export const meterPercent = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
