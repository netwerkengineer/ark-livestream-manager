import * as THREE from "three";
import type { QlcFixture } from "@/lib/qlcWorkspace";
import type { FixtureKind, StageFixture, StageCopy } from "@/lib/lightsStage";

// What each kind of lamp looks like (3D) and how its channels split into heads that can be lit separately (the KLS200 has four).

export interface Light { r: number; g: number; b: number; level: number }

const WARM: [number, number, number] = [1, 0.84, 0.66];
const TYPE = /^(\d+)(?:\.#([0-9A-Fa-f]{6}))?$/;

/** The channels of each head: a head is a run of colour channels (red, green, blue, ...) that starts again at the next red */
export function headsOf(f: QlcFixture, types: string[], kind: FixtureKind): number[][] {
  const heads: number[][] = [];
  let cur: number[] = [];
  let seenRed = false;
  for (let k = 0; k < f.channels; k++) {
    const i = f.address + k;
    const m = TYPE.exec(types[i] || "");
    if (!m || m[1] !== "0") continue;
    const hex = (m[2] || "000000").toUpperCase();
    if (hex === "000000") continue;   // a master dimmer belongs to all heads
    if (hex === "FF0000" && seenRed) { heads.push(cur); cur = []; }
    if (hex === "FF0000") seenRed = true;
    cur.push(i);
  }
  if (cur.length) heads.push(cur);
  if (heads.length === 0) {
    // channel types not known (yet) or a lamp with a lone dimmer: one head, and the four heads of a KLS when the types are missing
    return kind === "kls" && !types.some(Boolean) ? Array.from({ length: 4 }, () => []) : [[]];
  }
  return heads;
}

const masterOf = (f: QlcFixture, values: number[], types: string[]): number => {
  let master = -1;
  for (let k = 0; k < f.channels; k++) {
    const i = f.address + k;
    const m = TYPE.exec(types[i] || "");
    if (m && m[1] === "0" && (m[2] || "000000").toUpperCase() === "000000") master = Math.max(master, (values[i] || 0) / 255);
  }
  return master;
};

/** The light of every head of a lamp right now */
export function headLights(f: QlcFixture, values: number[], types: string[], kind: FixtureKind): Light[] {
  const master = masterOf(f, values, types);
  const heads = headsOf(f, types, kind);
  // no colour channels at all (a lone dimmer): warm white
  if (heads.length === 1 && heads[0].length === 0) {
    const v = Math.max(0, master);
    return [{ r: WARM[0] * v, g: WARM[1] * v, b: WARM[2] * v, level: v }];
  }
  return heads.map(chs => {
    let r = 0, g = 0, b = 0;
    for (const i of chs) {
      const v = (values[i] || 0) / 255;
      const hex = (TYPE.exec(types[i] || "")?.[2] || "000000").toUpperCase();
      r += (v * parseInt(hex.slice(0, 2), 16)) / 255; g += (v * parseInt(hex.slice(2, 4), 16)) / 255; b += (v * parseInt(hex.slice(4, 6), 16)) / 255;
    }
    const m = master < 0 ? 1 : master;
    r = Math.min(1, r) * m; g = Math.min(1, g) * m; b = Math.min(1, b) * m;
    return { r, g, b, level: Math.max(r, g, b) };
  });
}

/** The whole lamp as one colour (the plan symbol, the editor): the brightest head */
export function fixtureLightOf(f: QlcFixture, values: number[], types: string[], kind: FixtureKind): Light {
  const list = headLights(f, values, types, kind);
  return list.reduce((best, l) => (l.level > best.level ? l : best), list[0]);
}

export function aimOf(u: { pan: number; tilt: number }): THREE.Vector3 {
  const t = THREE.MathUtils.degToRad(u.tilt), p = THREE.MathUtils.degToRad(u.pan);
  return new THREE.Vector3(Math.sin(t) * Math.sin(p), -Math.cos(t), Math.sin(t) * Math.cos(p)).normalize();
}

/** Turns the lamp's own frame (beam along -Y, bar along X) to where it is aimed, then rolls it around the beam */
export function orientOf(u: { pan: number; tilt: number; roll?: number }): THREE.Quaternion {
  const dir = aimOf(u);
  // the bar axis (local X) lies level and across the beam; a lamp that points straight up or down keeps X along the world X axis
  const up = new THREE.Vector3(0, 1, 0);
  const x = Math.abs(dir.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(up, dir).normalize();
  const y = dir.clone().negate();                       // local +Y points away from the beam
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const base = new THREE.Quaternion().setFromRotationMatrix(m);
  return new THREE.Quaternion().setFromAxisAngle(dir, THREE.MathUtils.degToRad(u.roll || 0)).multiply(base);
}

export interface Model {
  group: THREE.Group;
  /** the glowing lenses, per head: their material takes the colour of the head */
  lenses: THREE.MeshBasicMaterial[];
  /** where each head's beam starts, in the lamp's own frame */
  heads: THREE.Vector3[];
}

const BLACK = () => new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.55, metalness: 0.2 });

/** Build the lamp in its own frame: the beam goes along -Y, a bar lies along X */
export function buildModel(kind: FixtureKind, headCount: number): Model {
  const group = new THREE.Group();
  const lenses: THREE.MeshBasicMaterial[] = [];
  const heads: THREE.Vector3[] = [];
  const lensMat = () => { const m = new THREE.MeshBasicMaterial({ color: 0x111111 }); lenses.push(m); return m; };
  const disc = (r: number, mat: THREE.Material, y: number, x = 0, z = 0) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
    d.rotation.x = Math.PI / 2;      // faces -Y (front)
    d.position.set(x, y, z);
    group.add(d);
    return d;
  };

  if (kind === "kls") {
    // a bar on a stand with square LED panels in a row, each lit by itself
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.035, 0.035), BLACK());
    bar.position.set(0, 0.1, 0); group.add(bar);
    const n = Math.max(1, headCount);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -0.45 + (i / (n - 1)) * 0.9;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.2), BLACK());
      body.position.set(x, 0, 0); group.add(body);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), lensMat());
      lens.rotation.x = Math.PI / 2; lens.position.set(x, -0.039, 0); group.add(lens);
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), BLACK());
      clip.position.set(x, 0.05, 0); group.add(clip);
      heads.push(new THREE.Vector3(x, -0.05, 0));
    }
  } else if (kind === "ubar" || kind === "bar") {
    // a bar of round lenses (nine for the ADJ bar)
    const len = 1.0, lensCount = kind === "ubar" ? 9 : 6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.1), BLACK());
    group.add(body);
    const mat = lensMat();
    for (let i = 0; i < lensCount; i++) disc(0.025, mat, -0.036, -len * 0.4 + (i / (lensCount - 1)) * len * 0.8);
    heads.push(new THREE.Vector3(0, -0.04, 0));
  } else if (kind === "colorbar") {
    // a long bar with a strip of small LEDs
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.07), BLACK());
    group.add(body);
    const mat = lensMat();
    for (let i = 0; i < 28; i++) {
      const led = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.018), mat);
      led.rotation.x = Math.PI / 2; led.position.set(-0.46 + (i / 27) * 0.92, -0.026, (i % 2 ? 0.012 : -0.012)); group.add(led);
    }
    heads.push(new THREE.Vector3(0, -0.03, 0));
  } else if (kind === "fresnel") {
    // a theatre lamp: a round housing with a big lens, on a yoke
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.26, 20), BLACK());
    group.add(can);
    disc(0.115, lensMat(), -0.132);
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 16, Math.PI), BLACK());
    yoke.rotation.z = Math.PI; yoke.rotation.y = Math.PI / 2; yoke.position.set(0, 0, 0); group.add(yoke);
    heads.push(new THREE.Vector3(0, -0.14, 0));
  } else {
    // a par can (the SlimPAR) in a U bracket, and the generic spot
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.13, 20), BLACK());
    group.add(can);
    const mat = lensMat();
    disc(0.075, mat, -0.066);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; disc(0.006, new THREE.MeshBasicMaterial({ color: 0x222222 }), -0.067, Math.cos(a) * 0.05, Math.sin(a) * 0.05); }
    const bracket = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 16, Math.PI), BLACK());
    bracket.rotation.z = Math.PI; bracket.rotation.y = Math.PI / 2; group.add(bracket);
    heads.push(new THREE.Vector3(0, -0.07, 0));
  }
  return { group, lenses, heads };
}

const cylBetween = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
  const v = b.clone().sub(a), len = v.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), BLACK());
  m.position.copy(a).addScaledVector(v, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
  return m;
};

/** A tripod stand under a lamp: a pole up to the lamp with three legs that spread out near the floor */
export function buildStand(top: THREE.Vector3, floorY: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Vector3(top.x, floorY, top.z);
  g.add(cylBetween(base.clone().setY(floorY + 0.35), new THREE.Vector3(top.x, top.y - 0.02, top.z), 0.016));   // the pole
  const hub = new THREE.Vector3(top.x, floorY + 0.55, top.z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    g.add(cylBetween(hub, new THREE.Vector3(top.x + Math.cos(a) * 0.5, floorY + 0.01, top.z + Math.sin(a) * 0.5), 0.011));
  }
  return g;
}

export type { StageFixture, StageCopy };
