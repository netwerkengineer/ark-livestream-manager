"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { QlcFixture } from "@/lib/qlcWorkspace";
import type { StageConfig, StageFixture, StageCopy, FixtureKind } from "@/lib/lightsStage";
import { useQlcFeed } from "@/lib/useQlcFeed";

// 2D plan and 3D view of the lights: the fixtures where they hang, lit with the DMX values QLC+ has right now.

interface Light { r: number; g: number; b: number; level: number }

const WARM = [1, 0.84, 0.66];

/** What a fixture shows right now, from its DMX channels and the channel types QLC+ reports ("0.#FF0000" = intensity with a colour) */
export function fixtureLight(f: QlcFixture, values: number[], types: string[]): Light {
  let r = 0, g = 0, b = 0, master = -1, coloured = false;
  for (let k = 0; k < f.channels; k++) {
    const i = f.address + k;
    const v = (values[i] || 0) / 255;
    const m = /^(\d+)(?:\.#([0-9A-Fa-f]{6}))?$/.exec(types[i] || "");
    if (!m || m[1] !== "0") continue;   // only intensity channels (group 0) make light
    const hex = m[2] ? m[2].toUpperCase() : "000000";
    if (hex === "000000") { master = Math.max(master, v); continue; }
    coloured = true;
    r += v * parseInt(hex.slice(0, 2), 16) / 255;
    g += v * parseInt(hex.slice(2, 4), 16) / 255;
    b += v * parseInt(hex.slice(4, 6), 16) / 255;
  }
  if (!coloured) { const v = Math.max(0, master); return { r: WARM[0] * v, g: WARM[1] * v, b: WARM[2] * v, level: v }; }
  const m = master < 0 ? 1 : master;
  r = Math.min(1, r) * m; g = Math.min(1, g) * m; b = Math.min(1, b) * m;
  return { r, g, b, level: Math.max(r, g, b) };
}

const cssColor = (l: Light) => `rgb(${Math.round(60 + 195 * l.r)}, ${Math.round(60 + 195 * l.g)}, ${Math.round(60 + 195 * l.b)})`;

function aim(f: StageFixture): THREE.Vector3 {
  const t = THREE.MathUtils.degToRad(f.tilt), p = THREE.MathUtils.degToRad(f.pan);
  return new THREE.Vector3(Math.sin(t) * Math.sin(p), -Math.cos(t), Math.sin(t) * Math.cos(p)).normalize();
}

const KINDS: { id: FixtureKind; label: string }[] = [
  { id: "par", label: "Par" }, { id: "fresnel", label: "Fresnel" }, { id: "bar", label: "Ledbalk" }, { id: "spot", label: "Spot" },
];

interface StageViewProps {
  /** DMX values to show instead of what QLC+ sends now (the scene editor previews the scene it is editing) */
  override?: number[];
  /** only the 3D view, without the plan and the panel */
  compact?: boolean;
}

export default function StageView({ override, compact }: StageViewProps) {
  const [stage, setStage] = useState<StageConfig | null>(null);
  const [fixtures, setFixtures] = useState<QlcFixture[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [lights, setLights] = useState<Record<number, Light>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selUnit, setSelUnit] = useState(0);   // 0 = the fixture itself, 1.. = its extra lamps
  const overrideRef = useRef<number[] | undefined>(override);
  overrideRef.current = override;
  const mount = useRef<HTMLDivElement>(null);
  const three = useRef<{ rebuild: (s: StageConfig, fx: QlcFixture[]) => void; dispose: () => void } | null>(null);
  const stageRef = useRef<StageConfig | null>(null);
  const fixturesRef = useRef<QlcFixture[]>([]);
  stageRef.current = stage;
  const ready = stage !== null;
  fixturesRef.current = fixtures;

  useEffect(() => {
    fetch("/api/lights/stage", { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        setStage(j.stage); setFixtures(j.fixtures);
        setSelected(j.fixtures[0]?.id ?? null);
      })
      .catch(err => setMessage({ ok: false, text: err instanceof Error ? err.message : "Laden mislukt" }));
  }, []);

  // Live values from QLC+ (or the override of the editor)
  const lightsFor = useCallback((vals: number[], types: string[]) => {
    const next: Record<number, Light> = {};
    for (const f of fixturesRef.current) next[f.id] = fixtureLight(f, vals, types);
    setLights(next);
  }, []);
  const feed = useQlcFeed((v, t) => { if (!overrideRef.current) lightsFor(v, t); });
  const values = feed.values, types = feed.types, connected = feed.connected;
  useEffect(() => { lightsFor(override ?? values.current, types.current); }, [override, fixtures, lightsFor, values, types]);

  // The 3D scene: built once, the fixtures are rebuilt when the layout changes and the colours are read from the live values every frame
  useEffect(() => {
    const el = mount.current;
    if (!el || !ready) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060d);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const room = new THREE.Group(); scene.add(room);
    const rig = new THREE.Group(); scene.add(rig);
    let live: { id: number; fixture: QlcFixture; lamp: THREE.SpotLight; beam: THREE.Mesh; glow: THREE.Mesh }[] = [];
    let framed = false;

    const disposeGroup = (grp: THREE.Group) => {
      grp.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose());
      });
      grp.clear();
    };

    const rebuild = (s: StageConfig, fx: QlcFixture[]) => {
      disposeGroup(room); disposeGroup(rig);
      live = [];
      const wall = new THREE.MeshStandardMaterial({ color: 0x20242e, roughness: 0.95 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.depth), new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.85 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, s.depth / 2); room.add(floor);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.height), wall);
      back.position.set(0, s.height / 2, 0); room.add(back);
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(s.depth, s.height), wall);
        w.rotation.y = -side * Math.PI / 2; w.position.set(side * s.width / 2, s.height / 2, s.depth / 2); room.add(w);
      }
      const grid = new THREE.GridHelper(Math.max(s.width, s.depth), Math.max(s.width, s.depth), 0x3b4252, 0x2b303b);
      grid.position.set(0, 0.005, s.depth / 2); room.add(grid);

      // the stage: a low platform, and the cross on the back wall
      if (s.stageDepth > 0 && s.stageWidth > 0) {
        const plat = new THREE.Mesh(new THREE.BoxGeometry(s.stageWidth, Math.max(0.02, s.stageHeight), s.stageDepth), new THREE.MeshStandardMaterial({ color: 0x1b1e27, roughness: 0.8 }));
        plat.position.set(0, Math.max(0.02, s.stageHeight) / 2, s.stageDepth / 2); room.add(plat);
      }
      const gold = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.5, metalness: 0.3 });
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.03), gold); crossV.position.set(0.2, s.height * 0.62, 0.03); room.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.03), gold); crossH.position.set(0.2, s.height * 0.7, 0.03); room.add(crossH);

      // distance from a point to the room's walls, floor and ceiling in a direction (a beam stops there)
      const rayLen = (o: THREE.Vector3, d: THREE.Vector3) => {
        let len = 12;
        const hit = (t: number) => { if (t > 0.05) len = Math.min(len, t); };
        if (d.y < -0.01) hit(-o.y / d.y); if (d.y > 0.01) hit((s.height - o.y) / d.y);
        if (d.z < -0.01) hit(-o.z / d.z); if (d.z > 0.01) hit((s.depth - o.z) / d.z);
        if (d.x < -0.01) hit((-s.width / 2 - o.x) / d.x); if (d.x > 0.01) hit((s.width / 2 - o.x) / d.x);
        return Math.max(0.5, len);
      };

      for (const f of fx) {
        const p = s.fixtures[String(f.id)];
        if (!p) continue;
        // the fixture itself and every extra lamp on the same DMX address
        for (const u of [p, ...(p.copies || [])]) {
          const dir = aim(u as StageFixture);
          const origin = new THREE.Vector3(u.x, u.y, u.z);
          const len = rayLen(origin, dir);
          const radius = Math.tan(THREE.MathUtils.degToRad(p.beam / 2)) * len;
          const cone = new THREE.ConeGeometry(radius, len, 28, 1, true);
          cone.translate(0, -len / 2, 0);
          const down = new THREE.Vector3(0, -1, 0);
          const orient = new THREE.Quaternion().setFromAxisAngle(dir, THREE.MathUtils.degToRad(u.roll || 0)).multiply(new THREE.Quaternion().setFromUnitVectors(down, dir));
          const beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
          beam.position.copy(origin);
          beam.quaternion.setFromUnitVectors(down, dir);
          rig.add(beam);
          const bodySize = p.kind === "bar" ? [0.9, 0.08, 0.08] : p.kind === "fresnel" ? [0.28, 0.28, 0.3] : [0.2, 0.2, 0.22];
          const body = new THREE.Mesh(new THREE.BoxGeometry(bodySize[0], bodySize[1], bodySize[2]), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.6 }));
          body.position.copy(origin); body.quaternion.copy(orient); rig.add(body);
          const glow = new THREE.Mesh(new THREE.SphereGeometry(p.kind === "bar" ? 0.07 : 0.11, 12, 12), new THREE.MeshBasicMaterial({ color: 0x111111 }));
          glow.position.copy(origin).addScaledVector(dir, 0.15); rig.add(glow);
          const lamp = new THREE.SpotLight(0xffffff, 0, 0, THREE.MathUtils.degToRad(Math.min(80, p.beam / 2)), 0.6, 1);
          lamp.position.copy(origin);
          lamp.target.position.copy(origin).addScaledVector(dir, len);
          rig.add(lamp); rig.add(lamp.target);
          live.push({ id: f.id, fixture: f, lamp, beam, glow });
        }
      }
      if (!framed) {
        camera.position.set(s.width * 0.28, 1.6, s.depth - 0.5);
        controls.target.set(0, 1.2, s.stageDepth * 0.5);
        controls.update();
        framed = true;
      }
    };
    three.current = { rebuild, dispose: () => {} };
    if (stageRef.current) rebuild(stageRef.current, fixturesRef.current);

    const color = new THREE.Color();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const l of live) {
        const c = fixtureLight(l.fixture, overrideRef.current ?? values.current, types.current);
        color.setRGB(c.r, c.g, c.b);
        l.lamp.color.copy(color); l.lamp.intensity = c.level * 35;
        const mat = l.beam.material as THREE.MeshBasicMaterial;
        mat.color.copy(color); mat.opacity = c.level * 0.07;
        (l.glow.material as THREE.MeshBasicMaterial).color.copy(c.level > 0.01 ? color : color.setRGB(0.07, 0.07, 0.07));
      }
      controls.update();
      renderer.render(scene, camera);
    };
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    tick();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      disposeGroup(room); disposeGroup(rig); renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, [ready]);

  useEffect(() => { if (stage && three.current) three.current.rebuild(stage, fixtures); }, [stage, fixtures]);

  const update = useCallback((id: number, patch: Partial<StageFixture>) => {
    setStage(s => (s ? { ...s, fixtures: { ...s.fixtures, [String(id)]: { ...s.fixtures[String(id)], ...patch } } } : s));
    setDirty(true);
  }, []);

  /** Change the main lamp (unit 0, also the beam and the kind) or one of its extra lamps */
  const updateUnit = useCallback((id: number, unit: number, patch: Partial<StageFixture>) => {
    if (unit === 0) { update(id, patch); return; }
    setStage(st => {
      if (!st) return st;
      const cur = st.fixtures[String(id)];
      const copies = (cur.copies || []).map((c, i) => (i === unit - 1 ? {
        x: patch.x ?? c.x, y: patch.y ?? c.y, z: patch.z ?? c.z, pan: patch.pan ?? c.pan, tilt: patch.tilt ?? c.tilt, roll: patch.roll ?? c.roll,
      } : c));
      const rest: Partial<StageFixture> = {};
      if (patch.beam !== undefined) rest.beam = patch.beam;
      if (patch.kind !== undefined) rest.kind = patch.kind;
      return { ...st, fixtures: { ...st.fixtures, [String(id)]: { ...cur, ...rest, copies } } };
    });
    setDirty(true);
  }, [update]);

  const save = async () => {
    if (!stage) return;
    try {
      const res = await fetch("/api/lights/stage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stage) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setStage(j.stage); setDirty(false);
      setMessage({ ok: true, text: "Opstelling opgeslagen." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Opslaan mislukt" });
    }
  };

  // ---- 2D plan (seen from above, the back wall at the top)
  const plan = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ id: number; unit: number } | null>(null);
  const PW = 440, PH = stage ? Math.round((PW * stage.depth) / stage.width) : 320;
  const toPlan = (x: number, z: number) => stage ? [((x + stage.width / 2) / stage.width) * PW, (z / stage.depth) * PH] : [0, 0];
  const fromPlan = (e: React.PointerEvent) => {
    const rect = plan.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * PW, py = ((e.clientY - rect.top) / rect.height) * PH;
    return { x: Math.round(((px / PW) * stage!.width - stage!.width / 2) * 20) / 20, z: Math.round(((py / PH) * stage!.depth) * 20) / 20 };
  };

  const selMain = selected !== null && stage ? stage.fixtures[String(selected)] : undefined;
  const sel = selMain ? (selUnit === 0 ? selMain : { ...selMain, ...(selMain.copies?.[selUnit - 1] || {}) }) : undefined;
  const selFixture = useMemo(() => fixtures.find(f => f.id === selected), [fixtures, selected]);

  if (!stage) return <p style={{ color: "var(--muted)" }}>{message ? message.text : "Laden…"}</p>;

  const field = (label: string, key: keyof StageFixture, min: number, max: number, step: number, unit: string) => (
    <label className="stg-field" key={key}>
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={sel ? (sel[key] as number) : 0} disabled={!sel}
        onChange={e => selected !== null && updateUnit(selected, selUnit, { [key]: Number(e.target.value) } as Partial<StageFixture>)} />
      <em>{unit}</em>
    </label>
  );

  return (
    <div className={`stg${compact ? " compact" : ""}`}>
      <div className="stg-3d" ref={mount} aria-label="3D-weergave van het podium" />
      {!compact && <div className="stg-side">
        <div className="stg-status">
          <span className={`stg-dot${connected ? " on" : ""}`} /> {connected ? "Live van QLC+" : "Geen verbinding met QLC+"}
          <button className="stg-btn" onClick={save} disabled={!dirty}>Opstelling opslaan</button>
        </div>
        {message && <div className={`stg-msg ${message.ok ? "ok" : "err"}`}>{message.text}</div>}
        <svg ref={plan} className="stg-plan" viewBox={`0 0 ${PW} ${PH}`}
          onPointerMove={e => { if (dragging.current !== null) { const p = fromPlan(e); updateUnit(dragging.current.id, dragging.current.unit, { x: p.x, z: p.z }); } }}
          onPointerUp={() => { dragging.current = null; }}
          onPointerLeave={() => { dragging.current = null; }}>
          <rect x={0} y={0} width={PW} height={PH} fill="#0e1220" stroke="#334155" />
          <text x={8} y={14} fill="#64748b" fontSize={10}>achterwand</text>
          <text x={8} y={PH - 6} fill="#64748b" fontSize={10}>publiek</text>
          {stage.stageDepth > 0 && stage.stageWidth > 0 && (() => {
            const [sx, sy] = toPlan(-stage.stageWidth / 2, 0), [ex, ey] = toPlan(stage.stageWidth / 2, stage.stageDepth);
            return <rect x={sx} y={sy} width={ex - sx} height={ey - sy} fill="#161a28" stroke="#475569" strokeDasharray="4 3" />;
          })()}
          {fixtures.flatMap(f => {
            const p = stage.fixtures[String(f.id)];
            if (!p) return [];
            const L = lights[f.id] || { r: 0, g: 0, b: 0, level: 0 };
            return [p as StageCopy & StageFixture, ...(p.copies || [])].map((u, unit) => {
              const [cx, cy] = toPlan(u.x, u.z);
              const a = THREE.MathUtils.degToRad(u.pan);
              const reach = 10 + 22 * Math.sin(THREE.MathUtils.degToRad(Math.min(90, u.tilt)));
              const isSel = f.id === selected && unit === selUnit;
              const along = Math.abs(Math.sin(THREE.MathUtils.degToRad(u.roll || 0))) > 0.7;   // a bar turned to lie along the z axis
              return (
                <g key={`${f.id}-${unit}`} style={{ cursor: "grab" }}
                  onPointerDown={e => { (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId); dragging.current = { id: f.id, unit }; setSelected(f.id); setSelUnit(unit); }}>
                  <line x1={cx} y1={cy} x2={cx + Math.sin(a) * reach} y2={cy + Math.cos(a) * reach} stroke={cssColor(L)} strokeWidth={2} opacity={0.6} />
                  {p.kind === "bar"
                    ? <rect x={cx - (along ? 3 : 10)} y={cy - (along ? 10 : 3)} width={along ? 6 : 20} height={along ? 20 : 6} rx={2} fill={cssColor(L)} stroke={isSel ? "#fff" : "#0b0c10"} strokeWidth={isSel ? 2 : 1} />
                    : <circle cx={cx} cy={cy} r={p.kind === "fresnel" ? 8 : 6} fill={cssColor(L)} stroke={isSel ? "#fff" : "#0b0c10"} strokeWidth={isSel ? 2 : 1} />}
                  {unit === 0 && <text x={cx} y={cy - 11} fill="#cbd5e1" fontSize={8} textAnchor="middle" pointerEvents="none">{f.name}</text>}
                </g>
              );
            });
          })}
        </svg>
        <div className="stg-panel">
          <strong>{selFixture ? selFixture.name : "Kies een lamp"}</strong>
          {selFixture && <span className="stg-meta">{selFixture.manufacturer} {selFixture.model} · kanaal {selFixture.address + 1}{selFixture.channels > 1 ? `–${selFixture.address + selFixture.channels}` : ""}</span>}
          {selMain && (
            <div className="stg-units">
              <span>Exemplaar</span>
              {[selMain, ...(selMain.copies || [])].map((_, i) => (
                <button key={i} className={`stg-chip${selUnit === i ? " on" : ""}`} onClick={() => setSelUnit(i)}>{i + 1}</button>
              ))}
              <button className="stg-chip" title="Nog een lamp op hetzelfde DMX-adres (zelfde licht)" onClick={() => {
                if (selected === null || !selMain) return;
                const base = selUnit === 0 ? selMain : { ...selMain, ...(selMain.copies?.[selUnit - 1] || {}) };
                setStage(st => st && ({ ...st, fixtures: { ...st.fixtures, [String(selected)]: { ...selMain, copies: [...(selMain.copies || []), { x: base.x + 0.5, y: base.y, z: base.z, pan: base.pan, tilt: base.tilt, roll: base.roll }] } } }));
                setSelUnit((selMain.copies || []).length + 1); setDirty(true);
              }}>+</button>
              {selUnit > 0 && <button className="stg-chip" title="Dit exemplaar verwijderen" onClick={() => {
                if (selected === null) return;
                setStage(st => st && ({ ...st, fixtures: { ...st.fixtures, [String(selected)]: { ...selMain, copies: (selMain.copies || []).filter((_, i) => i !== selUnit - 1) } } }));
                setSelUnit(0); setDirty(true);
              }}>✕</button>}
            </div>
          )}
          <div className="stg-grid">
            {field("Links/rechts", "x", -30, 30, 0.05, "m")}
            {field("Hoogte", "y", 0, 15, 0.05, "m")}
            {field("Diepte", "z", -2, 40, 0.05, "m")}
            {field("Richting", "pan", -360, 360, 5, "°")}
            {field("Kanteling", "tilt", 0, 180, 5, "°")}
            {field("Draai", "roll", -360, 360, 15, "°")}
            {field("Bundel", "beam", 3, 160, 1, "°")}
          </div>
          <label className="stg-field">
            <span>Soort</span>
            <select value={sel?.kind || "par"} disabled={!sel} onChange={e => selected !== null && updateUnit(selected, 0, { kind: e.target.value as FixtureKind })}>
              {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <div className="stg-grid">
            <label className="stg-field"><span>Breedte</span><input type="number" min={2} max={40} step={0.5} value={stage.width} onChange={e => { setStage({ ...stage, width: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
            <label className="stg-field"><span>Diepte</span><input type="number" min={2} max={40} step={0.5} value={stage.depth} onChange={e => { setStage({ ...stage, depth: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
            <label className="stg-field"><span>Podium breed</span><input type="number" min={0} max={40} step={0.1} value={stage.stageWidth} onChange={e => { setStage({ ...stage, stageWidth: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
            <label className="stg-field"><span>Podium diep</span><input type="number" min={0} max={60} step={0.1} value={stage.stageDepth} onChange={e => { setStage({ ...stage, stageDepth: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
            <label className="stg-field"><span>Podium hoog</span><input type="number" min={0} max={3} step={0.05} value={stage.stageHeight} onChange={e => { setStage({ ...stage, stageHeight: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
            <label className="stg-field"><span>Hoogte</span><input type="number" min={2} max={15} step={0.5} value={stage.height} onChange={e => { setStage({ ...stage, height: Number(e.target.value) }); setDirty(true); }} /><em>m</em></label>
          </div>
        </div>
      </div>}
    </div>
  );
}
