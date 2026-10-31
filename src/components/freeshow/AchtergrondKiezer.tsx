"use client";

import React, { useEffect, useRef, useState } from "react";

// Eigen achtergrond (video of afbeelding) voor een lied, gekozen uit de FreeShow-mediamap of net geüpload.
// De waarde is het pad vanaf de mediamap; leeg = de achtergrond van het lied laten zoals ze is.
interface MediaItem { name: string; relativePath: string; type: "image" | "video" }

export const UPLOADMAP = "Eigen achtergronden";

export default function AchtergrondKiezer({ value, mediaPath, onChange }: { value: string; mediaPath: string; onChange: (pad: string) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [fout, setFout] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const laad = () => fetch("/api/media/list").then(r => r.ok ? r.json() : null).then(d => {
    // de filmpjes van de sferen horen bij de sfeerkeuze
    if (d?.media) setItems((d.media as MediaItem[]).filter(m => !/(^|\/)Ark Visuals\//.test(m.relativePath)));
  }).catch(() => {});
  useEffect(() => { laad(); }, []);

  const groepen = new Map<string, MediaItem[]>();
  for (const m of items) {
    const map = m.relativePath.includes("/") ? m.relativePath.slice(0, m.relativePath.lastIndexOf("/")) : "Mediamap";
    groepen.set(map, [...(groepen.get(map) || []), m]);
  }
  const bekend = !value || items.some(m => m.relativePath === value);

  const upload = async (file: File) => {
    setBusy(true); setFout("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("directory", `${mediaPath.replace(/\/+$/, "")}/${UPLOADMAP}`);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Upload mislukt");
      const naam = String(j.filePath).split("/").pop() as string;
      await laad();
      onChange(`${UPLOADMAP}/${naam}`);
    } catch (e: any) {
      setFout(e.message || "Upload mislukt");
    } finally { setBusy(false); }
  };

  const stijl: React.CSSProperties = { background: "rgba(255,255,255,0.06)", color: "inherit", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", fontSize: "0.72rem", padding: "2px 4px", maxWidth: "11rem" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }} title={fout || "Eigen achtergrond (video of afbeelding) voor dit lied. Default: de achtergrond van de sfeer of het lied blijft zoals ze is."}>
      <select value={value} onChange={e => onChange(e.target.value)} style={stijl}>
        <option value="" style={{ color: "#000" }}>Achtergrond: default</option>
        {!bekend && <option value={value} style={{ color: "#000" }}>{value.split("/").pop()}</option>}
        {[...groepen.entries()].map(([map, lijst]) => (
          <optgroup key={map} label={map}>
            {lijst.map(m => <option key={m.relativePath} value={m.relativePath} style={{ color: "#000" }}>{m.type === "video" ? "🎞 " : "🖼 "}{m.name}</option>)}
          </optgroup>
        ))}
      </select>
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} title="Eigen video of afbeelding toevoegen" style={{ ...stijl, cursor: "pointer", padding: "2px 7px" }}>{busy ? "…" : "＋"}</button>
      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      {fout && <span style={{ color: "#f87171", fontSize: "0.7rem" }}>{fout}</span>}
    </span>
  );
}
