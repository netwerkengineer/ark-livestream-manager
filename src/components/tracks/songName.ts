// MultiTracks project names look like "<Title>-<Album>-<Key>-<Tempo>bpm".
export function parseSongName(name: string): { title: string; key?: string; bpm?: string } {
  const m = name.match(/^(.*)-([A-G][#b]?m?)-(\d+(?:\.\d+)?)bpm$/i);
  if (!m) return { title: name };
  const title = m[1].split("-")[0].replace(/\s*\((feat|ft|with)[^)]*\)/i, "").trim();
  return { title: title || m[1], key: m[2], bpm: String(Math.round(parseFloat(m[3]))) };
}

// Colour per section type, like the section bar in Playback.
export function sectionColor(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("count")) return "#475569";
  if (n.startsWith("pre")) return "#a855f7";
  if (n.startsWith("post")) return "#ec4899";
  if (n.startsWith("chorus") || n.startsWith("refrein")) return "#f43f5e";
  if (n.startsWith("verse") || n.startsWith("couplet")) return "#3b82f6";
  if (n.startsWith("bridge")) return "#f97316";
  if (n.startsWith("tag") || n.startsWith("vamp")) return "#eab308";
  if (n.startsWith("intro") || n.startsWith("outro") || n.startsWith("ending") || n.startsWith("end")) return "#14b8a6";
  return "#22c55e"; // interlude, turnaround, instrumental, ...
}
