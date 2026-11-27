import * as THREE from "three";
import {
  backdropFragment,
  backdropVertex,
  dustVertex,
  pointFragment,
  pulseVertex,
  sheetFragment,
  sheetPointsVertex,
  sheetVertex,
  strandFragment,
  strandVertex,
} from "./shaders";

export type FieldSystem = { name: string; count: number; pressure: boolean; formIndex?: number; tintIndex?: number };
export type FieldLink = {
  id: string;
  source: string;
  target: string;
  count: number;
  pressure: boolean;
};
export type FieldPick =
  | { kind: "system"; name: string }
  | { kind: "link"; id: string }
  | null;
export type FieldFocus = {
  selected: FieldPick;
  hovered: FieldPick;
  /** Systems cited by the finding selected in the intelligence feed. */
  emphasis: Set<string>;
};
export type FieldAnchors = {
  width: number;
  height: number;
  systems: { name: string; x: number; y: number; rx: number; ry: number }[];
  links: { id: string; x: number; y: number }[];
};

/* Each system is a soft, thick sheet. Silhouette, puffiness and how much
   the surface undulates differ per form so they read as different bodies. */
type FormCfg = {
  scale: [number, number, number];
  tilt: number;
  amp: number;
  puff: number;
  thick: number;
  lobe: [number, number, number, number];
};
const FORMS: FormCfg[] = [
  { scale: [1.55, 1, 0.95], tilt: 0.56, amp: 0.5, puff: 0.3, thick: 0.22, lobe: [0.17, 0.09, 0.12, 0] },
  { scale: [1.3, 1, 0.92], tilt: 0.6, amp: 0.42, puff: 0.42, thick: 0.3, lobe: [0.13, 0.12, 0.11, 0] },
  { scale: [1.62, 1, 0.84], tilt: 0.56, amp: 0.56, puff: 0.22, thick: 0.18, lobe: [0.2, 0.08, 0.12, 0] },
  { scale: [1.45, 1, 0.9], tilt: 0.56, amp: 0.48, puff: 0.34, thick: 0.24, lobe: [0.12, 0.13, 0.12, 0] },
];
/** Half extents of a form on screen, in its local units. */
const extent = (c: FormCfg) => ({
  rx: c.scale[0] * (1 + c.lobe[0] * 0.6),
  ry: c.scale[2] * Math.sin(c.tilt) + (c.puff + c.amp) * Math.cos(c.tilt) * 0.8,
});

const PALETTE: [number, number, number][] = [
  [0.3, 0.9, 0.82],
  [0.62, 0.56, 1.0],
  [0.42, 0.95, 0.55],
  [0.42, 0.8, 0.98],
  [0.62, 0.95, 0.85],
];
const PRESSURE: [number, number, number] = [1.0, 0.62, 0.28];

/** Global pace of the field. Every shader runs off uTime, so this one
    number slows morphing, fibres, light bands, pulses and dust together. */
const PACE = 0.5;
const CAMERA_Z = 14;
const FOV = 32;

function buildSheet() {
  const rows = 44;
  const cols = 160;
  const polar: number[] = [];
  for (let i = 0; i < rows; i++) {
    const r = 0.03 + (i / (rows - 1)) * 0.97;
    for (let j = 0; j < cols; j++) polar.push(r, (j / cols) * Math.PI * 2);
  }
  const index: number[] = [];
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j;
      const b = i * cols + ((j + 1) % cols);
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + ((j + 1) % cols);
      index.push(a, c, b, b, c, d);
    }
  const meshGeo = new THREE.BufferGeometry();
  meshGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(rows * cols * 3), 3));
  meshGeo.setAttribute("aPolar", new THREE.Float32BufferAttribute(polar, 2));
  meshGeo.setIndex(index);

  const n = 5200;
  const pp: number[] = [];
  const depth: number[] = [];
  const rand: number[] = [];
  for (let k = 0; k < n; k++) {
    const r = Math.random() < 0.18 ? 0.9 + Math.random() * 0.1 : Math.sqrt(Math.random());
    pp.push(r, Math.random() * Math.PI * 2);
    depth.push(Math.random() < 0.55 ? Math.random() * 0.08 : Math.pow(Math.random(), 1.3));
    rand.push(Math.random());
  }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  pointGeo.setAttribute("aPolar", new THREE.Float32BufferAttribute(pp, 2));
  pointGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(depth, 1));
  pointGeo.setAttribute("aRand", new THREE.Float32BufferAttribute(rand, 1));
  return { meshGeo, pointGeo };
}

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

type Form = {
  name: string;
  group: THREE.Group;
  cfg: FormCfg;
  points: THREE.Points;
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  uniforms: Record<string, THREE.IUniform>;
  size: number;
  intensity: number;
  target: number;
  pressure: boolean;
  color: THREE.Vector3;
  spin: number;
};
type Route = {
  link: FieldLink;
  strands: THREE.Mesh;
  pulses: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;
  intensity: number;
  target: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
};

export class FieldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private shared = {
    uTime: { value: 0 },
    uPixel: { value: 1 },
  };
  private forms: Form[] = [];
  private routes: Route[] = [];
  private dust?: THREE.Points;
  private backdrop: THREE.Mesh;
  private halo = haloTexture();
  private raf = 0;
  private last = 0;
  private running = false;
  private playing = true;
  private width = 1;
  private height = 1;
  private worldW = 1;
  private worldH = 1;
  private focus: FieldFocus = { selected: null, hovered: null, emphasis: new Set() };
  private sheet?: ReturnType<typeof buildSheet>;
  private orbits: THREE.LineLoop[] = [];
  onAnchors?: (anchors: FieldAnchors) => void;

  constructor(canvas: HTMLCanvasElement, private readonly composition: "overview" | "route" = "overview") {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.position.set(0, 0, CAMERA_Z);
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: backdropVertex,
        fragmentShader: backdropFragment,
        uniforms: { uTime: this.shared.uTime, uAspect: { value: new THREE.Vector2(1, 1) } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -10;
    const ring: number[] = [];
    for (let k = 0; k < 160; k++) ring.push(Math.cos((k / 160) * Math.PI * 2), Math.sin((k / 160) * Math.PI * 2), 0);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ring, 3));
    for (const opacity of [0.09, 0.05]) {
      const orbit = new THREE.LineLoop(
        ringGeo,
        new THREE.LineBasicMaterial({
          color: 0x7de8d0,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      orbit.renderOrder = -5;
      orbit.frustumCulled = false;
      this.orbits.push(orbit);
      this.scene.add(orbit);
    }
  }

  private additive<T extends THREE.ShaderMaterial>(m: T) {
    m.transparent = true;
    m.depthTest = false;
    m.depthWrite = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.AddEquation;
    return m;
  }

  private sheetGeometry() {
    return (this.sheet ??= buildSheet());
  }

  setData(systems: FieldSystem[], links: FieldLink[], scale?: { events: number; handoffs: number }) {
    this.clearData();
    const max = Math.max(1, scale?.events ?? 0, ...systems.map((s) => s.count));
    let tint = 0;
    systems.forEach((sys, i) => {
      const formIndex = sys.formIndex ?? i;
      const cfg = FORMS[formIndex % FORMS.length];
      const base = sys.pressure ? PRESSURE : PALETTE[(sys.tintIndex ?? tint++) % PALETTE.length];
      const color = new THREE.Vector3(...base);
      const uniforms: Record<string, THREE.IUniform> = {
        uTime: this.shared.uTime,
        uPixel: this.shared.uPixel,
        uSeed: { value: formIndex * 0.137 + 0.21 },
        uAmp: { value: cfg.amp },
        uPuff: { value: cfg.puff },
        uThick: { value: cfg.thick },
        uLobe: { value: new THREE.Vector4(...cfg.lobe) },
        uScale: { value: new THREE.Vector3(...cfg.scale) },
        uSize: { value: sys.pressure ? 1.7 : 1.45 },
        uIntensity: { value: 1 },
        uContour: { value: 6 },
        uColor: { value: color.clone() },
        uRim: { value: color.clone().lerp(new THREE.Vector3(1, 1, 1), 0.45) },
        uDeep: { value: color.clone().multiplyScalar(0.1) },
      };
      const geo = this.sheetGeometry();
      const mesh = new THREE.Mesh(
        geo.meshGeo,
        this.additive(
          new THREE.ShaderMaterial({ vertexShader: sheetVertex, fragmentShader: sheetFragment, uniforms, side: THREE.DoubleSide }),
        ),
      );
      const points = new THREE.Points(
        geo.pointGeo,
        this.additive(new THREE.ShaderMaterial({ vertexShader: sheetPointsVertex, fragmentShader: pointFragment, uniforms })),
      );
      points.frustumCulled = mesh.frustumCulled = false;
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.halo,
          color: new THREE.Color(base[0], base[1], base[2]),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          opacity: 0.3,
        }),
      );
      halo.renderOrder = -1;
      const group = new THREE.Group();
      const body = new THREE.Group();
      body.rotation.x = cfg.tilt;
      body.add(mesh, points);
      group.add(halo, body);
      this.scene.add(group);
      this.forms.push({
        name: sys.name,
        group,
        cfg,
        points,
        mesh,
        halo,
        uniforms,
        size: 1.02 + 0.2 * Math.sqrt(sys.count / max),
        intensity: 0,
        target: 1,
        pressure: sys.pressure,
        color,
        spin: (i % 2 ? -1 : 1) * (0.05 + i * 0.01),
      });
    });

    const maxLink = Math.max(1, scale?.handoffs ?? 0, ...links.map((l) => l.count));
    for (const link of links) {
      const from = this.forms.find((f) => f.name === link.source);
      const to = this.forms.find((f) => f.name === link.target);
      if (!from || !to || from === to) continue;
      const weight = link.count / maxLink;
      const strandCount = 10 + Math.round(weight * 18);
      const seg = 72;
      const aT: number[] = [];
      const aSide: number[] = [];
      const aOff: number[] = [];
      const aRand: number[] = [];
      const index: number[] = [];
      for (let k = 0; k < strandCount; k++) {
        const r = Math.random();
        const rad = Math.sqrt(Math.random());
        const ang = Math.random() * Math.PI * 2;
        const base = k * (seg + 1) * 2;
        for (let j = 0; j <= seg; j++) {
          for (const side of [-1, 1]) {
            aT.push(j / seg);
            aSide.push(side);
            aOff.push(rad, ang);
            aRand.push(r);
          }
          if (j < seg) {
            const v = base + j * 2;
            index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
          }
        }
      }
      const strandGeo = new THREE.BufferGeometry();
      strandGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aT.length * 3), 3));
      strandGeo.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
      strandGeo.setAttribute("aSide", new THREE.Float32BufferAttribute(aSide, 1));
      strandGeo.setAttribute("aOff", new THREE.Float32BufferAttribute(aOff, 2));
      strandGeo.setAttribute("aRand", new THREE.Float32BufferAttribute(aRand, 1));
      strandGeo.setIndex(index);

      const pulseCount = 2 + Math.round(weight * 7);
      const trail = 12;
      const aPhase: number[] = [];
      const aTrail: number[] = [];
      const pOff: number[] = [];
      for (let p = 0; p < pulseCount; p++) {
        const phase = p / pulseCount + Math.random() * 0.08;
        const off = (Math.random() - 0.5) * 1.6;
        for (let k = 0; k < trail; k++) {
          aPhase.push(phase);
          aTrail.push(k / (trail - 1));
          pOff.push(off);
        }
      }
      const pulseGeo = new THREE.BufferGeometry();
      pulseGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(aPhase.length * 3), 3));
      pulseGeo.setAttribute("aPhase", new THREE.Float32BufferAttribute(aPhase, 1));
      pulseGeo.setAttribute("aTrail", new THREE.Float32BufferAttribute(aTrail, 1));
      pulseGeo.setAttribute("aOff", new THREE.Float32BufferAttribute(pOff, 1));

      const ca = from.color.clone().lerp(new THREE.Vector3(1, 1, 1), 0.15);
      const cb = (link.pressure ? new THREE.Vector3(...PRESSURE) : to.color.clone()).lerp(new THREE.Vector3(1, 1, 1), 0.15);
      const uniforms: Record<string, THREE.IUniform> = {
        uTime: this.shared.uTime,
        uPixel: this.shared.uPixel,
        uP0: { value: new THREE.Vector3() },
        uP1: { value: new THREE.Vector3() },
        uP2: { value: new THREE.Vector3() },
        // The fibres resolve these two matrices and surface parameters in
        // their vertex shader, so their ends never lag behind a morph.
        uStartMatrix: { value: from.group.children[1].matrixWorld },
        uEndMatrix: { value: to.group.children[1].matrixWorld },
        uStartPolar: { value: new THREE.Vector2(0.88, 0) },
        uEndPolar: { value: new THREE.Vector2(0.88, 0) },
        uStartSeed: from.uniforms.uSeed,
        uEndSeed: to.uniforms.uSeed,
        uStartAmp: from.uniforms.uAmp,
        uEndAmp: to.uniforms.uAmp,
        uStartPuff: from.uniforms.uPuff,
        uEndPuff: to.uniforms.uPuff,
        uStartScale: from.uniforms.uScale,
        uEndScale: to.uniforms.uScale,
        uStartLobe: from.uniforms.uLobe,
        uEndLobe: to.uniforms.uLobe,
        uPerp: { value: new THREE.Vector3() },
        uWidth: { value: 0.14 + weight * 0.2 },
        uThick: { value: 0.016 + weight * 0.01 },
        uFlow: { value: 0.32 + weight * 0.12 },
        uSeed: { value: Math.random() },
        uSway: { value: 0.26 + Math.random() * 0.16 },
        uCA: { value: ca },
        uCB: { value: cb },
        uIntensity: { value: 1 },
        uSpeed: { value: 0.075 + weight * 0.035 },
        uSize: { value: link.pressure ? 4.0 : 3.0 },
        uLineGain: { value: 1.0 },
      };
      const strands = new THREE.Mesh(
        strandGeo,
        this.additive(
          new THREE.ShaderMaterial({ vertexShader: strandVertex, fragmentShader: strandFragment, uniforms, side: THREE.DoubleSide }),
        ),
      );
      const pulses = new THREE.Points(
        pulseGeo,
        this.additive(new THREE.ShaderMaterial({ vertexShader: pulseVertex, fragmentShader: pointFragment, uniforms })),
      );
      strands.frustumCulled = pulses.frustumCulled = false;
      this.scene.add(strands, pulses);
      this.routes.push({
        link,
        strands,
        pulses,
        uniforms,
        intensity: 0,
        target: 1,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
      });
    }

    const dustCount = 420;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 30;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute("aRand", new THREE.BufferAttribute(Float32Array.from({ length: dustCount }, () => Math.random()), 1));
    this.dust = new THREE.Points(
      dustGeo,
      this.additive(
        new THREE.ShaderMaterial({
          vertexShader: dustVertex,
          fragmentShader: pointFragment,
          uniforms: { uTime: this.shared.uTime, uPixel: this.shared.uPixel, uBox: { value: new THREE.Vector2(15, 6) } },
        }),
      ),
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.layout();
    this.applyFocus();
  }

  private clearData() {
    for (const f of this.forms) {
      this.scene.remove(f.group);
      (f.points.material as THREE.Material).dispose();
      (f.mesh.material as THREE.Material).dispose();
      f.halo.material.dispose();
    }
    for (const r of this.routes) {
      this.scene.remove(r.strands, r.pulses);
      r.strands.geometry.dispose();
      r.pulses.geometry.dispose();
      (r.strands.material as THREE.Material).dispose();
      (r.pulses.material as THREE.Material).dispose();
    }
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
      (this.dust.material as THREE.Material).dispose();
      this.dust = undefined;
    }
    this.forms = [];
    this.routes = [];
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.applyPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.worldH = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.worldW = this.worldH * this.camera.aspect;
    (this.backdrop.material as THREE.ShaderMaterial).uniforms.uAspect.value.set(this.camera.aspect, 1);
    this.layout();
    if (!this.running) this.render();
  }

  /** Places forms on an ellipse (left, top, right, bottom for four systems). */
  private layout() {
    const n = this.forms.length;
    if (!n) return;
    const portrait = this.worldW < this.worldH * 1.05;
    const unit = Math.min(this.worldW / (portrait ? 11 : 11.6), this.worldH / (portrait ? 8.2 : 6.1));
    const rx = this.worldW * (portrait ? 0.26 : 0.31);
    const ry = this.worldH * (portrait ? 0.29 : 0.25);
    this.forms.forEach((f, i) => {
      const angle = Math.PI - (i * Math.PI * 2) / n;
      const jitter = n === 4 ? [[-0.02, 0.06], [-0.08, 0.0], [0.02, 0.06], [0.06, -0.02]][i] : [0, 0];
      const scale = unit * f.size * (this.composition === "route" ? 1.32 : 1);
      f.group.position.set(
        Math.cos(angle) * rx + jitter[0] * this.worldW,
        Math.sin(angle) * ry + jitter[1] * this.worldH,
        0,
      );
      if (this.composition === "route") {
        // A directed pair reads left to right; the destination rises slightly.
        f.group.position.set((i === 0 ? -0.265 : 0.265) * this.worldW,
          (i === 0 ? -0.07 : 0.07) * this.worldH, 0);
      }
      f.group.scale.setScalar(scale);
      const e = extent(f.cfg);
      f.halo.scale.set(e.rx * 2.6, e.ry * 2.8 + 0.4, 1);
    });
    this.orbits[0]?.scale.set(rx * 1.1, ry * 1.18, 1);
    this.orbits[1]?.scale.set(rx * 1.28, ry * 0.86, 1);
    for (const o of this.orbits) o.position.set(0, -0.15, -0.5);
    const center = new THREE.Vector3();
    this.scene.updateMatrixWorld(true);
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    for (const r of this.routes) {
      const a = this.forms.find((f) => f.name === r.link.source)!;
      const b = this.forms.find((f) => f.name === r.link.target)!;
      const A = a.group.position;
      const B = b.group.position;
      const dir = B.clone().sub(A);
      const dist = dir.length();
      dir.normalize();
      const perp = new THREE.Vector3(dir.y, -dir.x, 0);
      // Select a rim point facing the other form in each body's local space.
      // Subsequent body sway is included by the shared world matrix above.
      a.group.children[1].getWorldQuaternion(qa).invert();
      b.group.children[1].getWorldQuaternion(qb).invert();
      const la = dir.clone().applyQuaternion(qa);
      const lb = dir.clone().negate().applyQuaternion(qb);
      r.uniforms.uStartPolar.value.set(0.88, Math.atan2(la.z, la.x));
      r.uniforms.uEndPolar.value.set(0.88, Math.atan2(lb.z, lb.x));
      const ra = a.group.scale.x * extent(a.cfg).rx * 0.5;
      const rb = b.group.scale.x * extent(b.cfg).rx * 0.5;
      r.p0.copy(A).addScaledVector(dir, Math.min(ra, dist * 0.3));
      r.p2.copy(B).addScaledVector(dir, -Math.min(rb, dist * 0.3));
      center.copy(r.p0).add(r.p2).multiplyScalar(0.5);
      r.p1.copy(center).addScaledVector(perp, dist * 0.16);
      r.p1.z = 0.45;
      r.uniforms.uP0.value.copy(r.p0);
      r.uniforms.uP1.value.copy(r.p1);
      r.uniforms.uP2.value.copy(r.p2);
      r.uniforms.uPerp.value.copy(perp);
    }
    this.emitAnchors();
  }

  private toScreen(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (0.5 - p.y * 0.5) * this.height };
  }

  private bezierAt(r: Route, t: number) {
    const u = 1 - t;
    return new THREE.Vector3()
      .addScaledVector(r.p0, u * u)
      .addScaledVector(r.p1, 2 * u * t)
      .addScaledVector(r.p2, t * t);
  }

  private emitAnchors() {
    if (!this.onAnchors) return;
    const pxPerUnit = this.width / this.worldW;
    this.onAnchors({
      width: this.width,
      height: this.height,
      systems: this.forms.map((f) => {
        const c = this.toScreen(f.group.position);
        const e = extent(f.cfg);
        return {
          name: f.name,
          x: c.x,
          y: c.y,
          rx: f.group.scale.x * e.rx * pxPerUnit,
          ry: f.group.scale.x * e.ry * pxPerUnit,
        };
      }),
      links: this.routes.map((r) => ({ id: r.link.id, ...this.toScreen(this.bezierAt(r, 0.5)) })),
    });
  }

  /** Hit test in CSS pixels relative to the canvas. */
  pick(x: number, y: number): FieldPick {
    let best: FieldPick = null;
    let bestScore = Infinity;
    const pxPerUnit = this.width / this.worldW;
    for (const f of this.forms) {
      const c = this.toScreen(f.group.position);
      const e = extent(f.cfg);
      const rx = f.group.scale.x * e.rx * pxPerUnit;
      const ry = f.group.scale.x * e.ry * pxPerUnit * 1.1;
      const d = Math.hypot((x - c.x) / rx, (y - c.y) / ry);
      if (d < 0.95 && d < bestScore) {
        bestScore = d;
        best = { kind: "system", name: f.name };
      }
    }
    if (best && bestScore < 0.6) return best;
    let linkBest: FieldPick = null;
    let linkDist = 12;
    for (const r of this.routes) {
      let prev = this.toScreen(r.p0);
      for (let k = 1; k <= 28; k++) {
        const next = this.toScreen(this.bezierAt(r, k / 28));
        const d = segmentDistance(x, y, prev.x, prev.y, next.x, next.y);
        if (d < linkDist) {
          linkDist = d;
          linkBest = { kind: "link", id: r.link.id };
        }
        prev = next;
      }
    }
    return linkBest || best;
  }

  setFocus(focus: FieldFocus) {
    this.focus = focus;
    this.applyFocus();
    if (!this.running) this.render();
  }

  private applyFocus() {
    const { selected, hovered, emphasis } = this.focus;
    const selRoute = selected?.kind === "link" ? this.routes.find((r) => r.link.id === selected.id) : undefined;
    const selSystem = selected?.kind === "system" ? selected.name : undefined;
    for (const f of this.forms) {
      let t = f.pressure ? 1.12 : 1;
      if (selSystem) t = f.name === selSystem ? 1.7 : 0.42;
      else if (selRoute) t = f.name === selRoute.link.source || f.name === selRoute.link.target ? 1.35 : 0.38;
      else if (emphasis.size) t = emphasis.has(f.name) ? 1.4 : 0.72;
      if (hovered?.kind === "system" && hovered.name === f.name) t += 0.3;
      f.target = t;
    }
    for (const r of this.routes) {
      let t = r.link.pressure ? 1.2 : 0.95;
      if (selRoute) t = r === selRoute ? 2.4 : 0.22;
      else if (selSystem) t = r.link.source === selSystem || r.link.target === selSystem ? 1.75 : 0.22;
      else if (emphasis.size) t = emphasis.has(r.link.source) && emphasis.has(r.link.target) ? 1.6 : 0.6;
      if (hovered?.kind === "link" && hovered.id === r.link.id) t += 0.9;
      r.target = t;
    }
  }

  renderStill() {
    for (const f of this.forms) {
      f.intensity = f.target;
      f.uniforms.uIntensity.value = f.target;
      f.halo.material.opacity = 0.05 + 0.09 * f.target;
    }
    for (const r of this.routes) r.uniforms.uIntensity.value = r.intensity = r.target;
    this.render();
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  /** Starts or stops the frame loop (e.g. when scrolled out of view). */
  setActive(active: boolean) {
    if (active === this.running) return;
    this.running = active;
    if (active) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else cancelAnimationFrame(this.raf);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    // rAF timestamps can precede the performance.now() taken when starting.
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.adapt(now - this.last);
    this.last = now;
    if (this.playing) this.shared.uTime.value += dt * PACE;
    const ease = 1 - Math.exp(-dt * 6);
    const time = this.shared.uTime.value;
    for (const f of this.forms) {
      f.intensity += (f.target - f.intensity) * ease;
      f.uniforms.uIntensity.value = f.intensity;
      f.halo.material.opacity = 0.05 + 0.09 * f.intensity * (f.pressure ? 1.3 : 1);
      // A slow sway, never a spin: the life is in the surface itself.
      f.group.children[1].rotation.y = Math.sin(time * f.spin + f.uniforms.uSeed.value * 9) * 0.12;
      f.group.children[1].rotation.z = Math.sin(time * f.spin * 0.7 + 1.3) * 0.04;
    }
    this.scene.updateMatrixWorld(true);
    for (const r of this.routes) {
      r.intensity += (r.target - r.intensity) * ease;
      r.uniforms.uIntensity.value = r.intensity;
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private slow = 0;
  private fast = 0;
  /** Drops the pixel ratio on devices that cannot hold ~25fps. */
  private adapt(ms: number) {
    if (!(ms > 0) || ms > 1000) return;
    const dpr = this.renderer.getPixelRatio();
    if (ms > 40) {
      this.slow++;
      this.fast = 0;
    } else {
      this.fast++;
      this.slow = Math.max(0, this.slow - 1);
    }
    if (this.slow > 24 && dpr > 1) {
      this.slow = 0;
      this.applyPixelRatio(Math.max(1, dpr - 0.5));
    }
  }

  private applyPixelRatio(dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.shared.uPixel.value = dpr;
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Current clock in seconds; exposed for diagnostics. */
  get time() {
    return this.shared.uTime.value;
  }

  dispose() {
    this.setActive(false);
    this.clearData();
    this.sheet?.meshGeo.dispose();
    this.sheet?.pointGeo.dispose();
    this.sheet = undefined;
    for (const o of this.orbits) (o.material as THREE.Material).dispose();
    this.orbits[0]?.geometry.dispose();
    this.halo.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
