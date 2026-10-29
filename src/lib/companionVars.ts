import { getSettings } from "./settingsStore";

// Companion's custom variables (licht_auto, licht_kleur, licht_tijd) read and written over its HTTP API.

function companionBases(): string[] {
  const s = getSettings() as any;
  const port = s.companionPort || 8000;
  const hosts = [s.companionHost, "127.0.0.1", "172.17.0.1", "companion"].filter(Boolean);
  return Array.from(new Set(hosts)).map(h => `http://${h}:${port}`);
}

export async function companion(pathAndQuery: string, method: "GET" | "POST"): Promise<string | null> {
  for (const base of companionBases()) {
    try {
      const res = await fetch(`${base}${pathAndQuery}`, { method, cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (res.ok) return (await res.text()).trim();
    } catch {
      // volgende host proberen
    }
  }
  return null;
}
