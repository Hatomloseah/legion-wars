import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { type BattleSim, CAP, CAUSE } from "@/lib/sim/engine";
import { FX } from "@/lib/sim/fixed";
import type { DroneDesign } from "@/lib/sim/types";
import type { FxBatch } from "./lockstep";

const INV = 1 / FX;
const MAX_TRACERS = 1600;
const MAX_PARTICLES = 6000;
const MAX_DECOYS = 320;
const LIME = new THREE.Color("#C6FF3D");
const SIGNAL = new THREE.Color("#FF3B30");
const HOT = new THREE.Color("#FF6A2B");
const WHITE = new THREE.Color("#ffffff");

// render-only per-slot variation (not part of the deterministic sim)
const ALT = new Float32Array(CAP);
const BRIGHT = new Float32Array(CAP);
for (let i = 0; i < CAP; i++) {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  ALT[i] = 18 + (h % 70);
  BRIGHT[i] = 0.82 + ((h >>> 8) % 100) / 300;
}

function droneGeometry(design: DroneDesign): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (design) {
    case "dart":
      g = new THREE.ConeGeometry(3.6, 14, 4);
      g.rotateZ(-Math.PI / 2);
      break;
    case "orb":
      g = new THREE.IcosahedronGeometry(4.8, 0);
      break;
    case "delta":
      g = new THREE.ConeGeometry(7, 13, 3);
      g.rotateZ(-Math.PI / 2);
      g.scale(1, 0.32, 1);
      break;
    default:
      g = new THREE.OctahedronGeometry(4.8, 0);
      g.scale(2.1, 0.55, 0.7);
      break;
  }
  return g;
}

const groundVert = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const groundFrag = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uTime;
varying vec2 vXZ;
float gridLine(vec2 p, float spacing, float width) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
  vec2 fw = fwidth(p) * width;
  vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g);
  return max(l.x, l.y);
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
void main() {
  vec2 p = vXZ;
  vec2 d = abs(p) - vec2(900.0, 550.0);
  float box = max(d.x, d.y);
  float inside = step(box, 0.0);
  float edge = 1.0 - smoothstep(0.0, 2.5, abs(box));
  float fine = gridLine(p, 50.0, 1.0);
  float major = gridLine(p, 200.0, 1.4);

  // hex lattice
  vec2 s = vec2(1.0, 1.7320508) * 60.0;
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float hx = smoothstep(27.0, 29.5, hexDist(gv)) * 0.5;

  vec3 col = vec3(0.022, 0.03, 0.032);
  col += vec3(0.8, 1.0, 0.75) * (fine * 0.03 + major * 0.06 + hx * 0.035 * inside) * (0.35 + 0.65 * inside);
  float ta = smoothstep(-250.0, -900.0, p.x) * inside;
  float tb = smoothstep(250.0, 900.0, p.x) * inside;
  col += uColA * ta * 0.07 + uColB * tb * 0.07;
  col += vec3(0.776, 1.0, 0.239) * edge * 0.4;
  float cl = (1.0 - smoothstep(0.0, 1.8, abs(p.x))) * step(0.5, fract(p.y / 36.0)) * inside;
  col += vec3(0.776, 1.0, 0.239) * cl * 0.22;
  float sweepX = mod(uTime * 260.0, 2600.0) - 1300.0;
  float sweep = 1.0 - smoothstep(0.0, 90.0, abs(p.x - sweepX));
  col += vec3(0.776, 1.0, 0.239) * sweep * 0.03 * inside;
  float r = length(p / vec2(1400.0, 950.0));
  col *= 1.0 - smoothstep(0.65, 1.2, r);
  gl_FragColor = vec4(col, 1.0);
}`;

const particleVert = /* glsl */ `
attribute float psize;
attribute vec3 pcolor;
attribute float palpha;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
  vColor = pcolor;
  vAlpha = palpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const particleFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vColor * a * vAlpha * 1.8, 1.0);
}`;

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  active: boolean;
}
interface Beam {
  mesh: THREE.Mesh;
  t: number;
  active: boolean;
}

export interface RendererOptions {
  compact?: boolean;
  mobile?: boolean;
}

export class BattleRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ro: ResizeObserver;
  private opts: RendererOptions;
  private time = 0;
  private shakeAmp = 0;

  private colors: [THREE.Color, THREE.Color] = [new THREE.Color("#FF7A1A"), new THREE.Color("#7CD8FF")];
  private drones: THREE.InstancedMesh[] = [];
  private decoys: THREE.InstancedMesh[] = [];
  private groundMat: THREE.ShaderMaterial;

  private trailGeo = new THREE.BufferGeometry();
  private trailPos = new Float32Array(CAP * 6);
  private trailCol = new Float32Array(CAP * 6);
  private trails: THREE.LineSegments;

  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(MAX_TRACERS * 6);
  private tracerCol = new Float32Array(MAX_TRACERS * 6);

  private pGeo = new THREE.BufferGeometry();
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pCol = new Float32Array(MAX_PARTICLES * 3);
  private pBase = new Float32Array(MAX_PARTICLES * 3);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pSize0 = new Float32Array(MAX_PARTICLES);
  private pAlpha = new Float32Array(MAX_PARTICLES);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMax = new Float32Array(MAX_PARTICLES);
  private pCursor = 0;
  private pMat: THREE.ShaderMaterial;

  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private shields: THREE.Mesh[] = [];
  private tmpColor = new THREE.Color();
  private disposed = false;
  /** adaptive quality: 2 = full (bloom), 1 = no bloom, 0 = low-res, no trails, half drones */
  quality = 2;
  private emaMs = 8;
  private slowFrames = 0;
  private decim = 1;

  constructor(container: HTMLElement, opts: RendererOptions = {}) {
    this.container = container;
    this.opts = opts;
    const mobile = !!opts.mobile;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance", alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : opts.compact ? 1.5 : 1.75));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x07090a, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.FogExp2(0x07090a, 0.00038);

    this.camera = new THREE.PerspectiveCamera(opts.compact ? 46 : 50, w / h, 1, 8000);
    this.camera.position.set(0, opts.compact ? 980 : 820, opts.compact ? 1160 : 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 40);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.25;
    this.controls.minDistance = 380;
    this.controls.maxDistance = 2600;
    this.controls.enablePan = !opts.compact;
    this.controls.enableZoom = !opts.compact;
    this.controls.autoRotate = !!opts.compact;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.update();

    // ground
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uColA: { value: this.colors[0] }, uColB: { value: this.colors[1] }, uTime: { value: 0 } },
      vertexShader: groundVert,
      fragmentShader: groundFrag,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 3000), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.scene.add(this.arenaBrackets());

    // trails
    this.trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute("color", new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trails = new THREE.LineSegments(
      this.trailGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.trails.frustumCulled = false;
    this.trails.visible = !mobile;
    this.scene.add(this.trails);

    // tracers
    this.tracerGeo.setAttribute("position", new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute("color", new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tracers = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    tracers.frustumCulled = false;
    this.scene.add(tracers);

    // particles
    this.pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute("pcolor", new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute("psize", new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute("palpha", new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: h * 1.1 } },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.pGeo, this.pMat);
    points.frustumCulled = false;
    this.scene.add(points);

    // ring + beam pools
    const ringGeo = new THREE.RingGeometry(0.94, 1, 72);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, r0: 0, r1: 1, active: false });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.beams.push({ mesh, t: 0, active: false });
    }
    for (let s = 0; s < 2; s++) {
      const sh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      sh.visible = false;
      this.scene.add(sh);
      this.shields.push(sh);
    }

    // post
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bw = mobile ? w / 2 : w;
    const bh = mobile ? h / 2 : h;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(bw, bh), mobile ? 0.8 : 1.05, 0.55, 0.08);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.decim = mobile ? 2 : 1;
    // software GL (SwiftShader / llvmpipe) starts in low quality so it never freezes the page
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      if (/swiftshader|llvmpipe|software/i.test(name)) this.setQuality(0);
    } catch {
      // ignore
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }

  private arenaBrackets(): THREE.LineSegments {
    const pts: number[] = [];
    const L = 80;
    const W = 900;
    const D = 550;
    const y = 0.5;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * W;
        const z = sz * D;
        pts.push(x, y, z, x - sx * L, y, z, x, y, z, x, y, z - sz * L);
      }
    }
    // gate ticks
    for (const sx of [-1, 1]) {
      for (let z = -500; z <= 500; z += 50) {
        const len = z % 250 === 0 ? 26 : 10;
        pts.push(sx * 900, y, z, sx * (900 + len), y, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: 0.7 }));
  }

  setSides(colors: [string, string], designs: [DroneDesign, DroneDesign]): void {
    for (const m of this.drones) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const m of this.decoys) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.drones = [];
    this.decoys = [];
    for (let s = 0; s < 2; s++) {
      this.colors[s].set(colors[s]);
      const geo = droneGeometry(designs[s]);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      this.drones.push(mesh);

      const dm = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ color: this.colors[s], wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
        MAX_DECOYS,
      );
      dm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dm.frustumCulled = false;
      dm.count = 0;
      this.scene.add(dm);
      this.decoys.push(dm);
    }
    this.groundMat.uniforms.uColA.value = this.colors[0];
    this.groundMat.uniforms.uColB.value = this.colors[1];
  }

  shake(amount: number): void {
    this.shakeAmp = Math.min(40, this.shakeAmp + amount);
  }

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.pMat.uniforms.uScale.value = h * 1.1;
  }

  // ---------------------------------------------------------------- fx
  private emit(x: number, y: number, z: number, color: THREE.Color, n: number, speed: number, size: number, life: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = r * Math.cos(th) * sp;
      this.pVel[i * 3 + 1] = u * sp * 0.7 + speed * 0.15;
      this.pVel[i * 3 + 2] = r * Math.sin(th) * sp;
      this.pBase[i * 3] = color.r;
      this.pBase[i * 3 + 1] = color.g;
      this.pBase[i * 3 + 2] = color.b;
      this.pSize0[i] = size * (0.6 + Math.random() * 0.6);
      this.pMax[i] = life * (0.7 + Math.random() * 0.6);
      this.pLife[i] = this.pMax[i];
    }
  }

  private ring(x: number, z: number, color: THREE.Color, r0: number, r1: number, dur: number, y = 2): void {
    const ring = this.rings.find((r) => !r.active) ?? this.rings[0];
    ring.active = true;
    ring.t = 0;
    ring.dur = dur;
    ring.r0 = r0;
    ring.r1 = r1;
    ring.mesh.position.set(x, y, z);
    (ring.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    ring.mesh.visible = true;
  }

  private beam(x: number, z: number, color: THREE.Color): void {
    const b = this.beams.find((r) => !r.active) ?? this.beams[0];
    b.active = true;
    b.t = 0;
    b.mesh.position.set(x, 160, z);
    (b.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    b.mesh.visible = true;
  }

  private consumeFx(fx: FxBatch): void {
    for (const d of fx.deaths) {
      const y = 30;
      const c = this.colors[d.side];
      if (d.cause === CAUSE.sell) {
        this.emit(d.x, y, d.z, SIGNAL, 9, 140, 16, 0.9);
        this.emit(d.x, y, d.z, HOT, 3, 60, 34, 0.35);
      } else if (d.cause === CAUSE.kamikaze) {
        this.emit(d.x, y, d.z, HOT, 7, 180, 18, 0.8);
        this.emit(d.x, y, d.z, WHITE, 2, 40, 40, 0.25);
      } else if (d.decoy || d.cause === CAUSE.expire) {
        this.emit(d.x, y, d.z, c, 3, 50, 8, 0.4);
      } else {
        this.tmpColor.copy(c).lerp(WHITE, 0.35);
        this.emit(d.x, y, d.z, this.tmpColor, 7, 110, 13, 0.75);
        this.emit(d.x, y, d.z, WHITE, 1, 10, 30, 0.18);
      }
    }
    for (const s of fx.spawns) {
      const c = this.colors[s.side];
      const gx = s.side === 0 ? -900 : 900;
      this.beam(gx, s.z, c);
      this.ring(gx, s.z, c, 10, 120 + s.count * 1.5, 1.1);
      this.emit(gx, 60, s.z, c, Math.min(40, 8 + s.count), 160, 14, 0.9);
      if (s.count >= 30) this.shake(6 + s.count / 8);
    }
    for (const a of fx.abilities) {
      const c = this.colors[a.side];
      if (a.kind === "emp") {
        this.ring(a.x, a.z, WHITE, 5, a.r, 0.7, 20);
        this.ring(a.x, a.z, c, 5, a.r * 1.15, 1.1, 4);
        this.emit(a.x, 30, a.z, WHITE, 26, 260, 10, 0.5);
        this.shake(5);
      } else if (a.kind === "kamikaze") {
        if (a.r > 0) {
          this.ring(a.x, a.z, HOT, 4, a.r * 1.4, 0.55, 10);
        } else {
          this.ring(a.x, a.z, HOT, 30, 180, 0.9, 3);
        }
      } else if (a.kind === "shield") {
        this.ring(a.x, a.z, c, 40, 260, 1.2, 3);
      } else {
        this.ring(a.x, a.z, c, 10, a.r * 1.2, 0.9, 3);
        this.emit(a.x, 40, a.z, c, 18, 80, 9, 0.6);
      }
    }
  }

  // ---------------------------------------------------------------- frame
  frame(sim: BattleSim, alpha: number, dt: number, fx: FxBatch): void {
    if (this.disposed) return;
    this.time += dt;
    this.groundMat.uniforms.uTime.value = this.time;
    this.consumeFx(fx);

    const t = this.time;
    const decim = this.decim;
    const n = sim.n;
    const counts = [0, 0];
    const dcounts = [0, 0];
    let trailN = 0;
    let tracerN = 0;
    const tick = sim.tick;
    const shieldOn = [sim.s[0].shield > 0, sim.s[1].shield > 0];
    const c = this.tmpColor;

    for (let i = 0; i < n; i++) {
      if (!sim.alive[i]) continue;
      const sd = sim.side[i];
      const px = sim.px[i];
      const pz = sim.pz[i];
      const x = (px + (sim.x[i] - px) * alpha) * INV;
      const z = (pz + (sim.z[i] - pz) * alpha) * INV;
      const vx = sim.vx[i] * INV;
      const vz = sim.vz[i] * INV;
      const age = tick - sim.born[i];
      let y = ALT[i] + Math.sin(t * 2.1 + i * 0.73) * 3;
      if (age < 45 && sim.born[i] >= 0) {
        const k = 1 - age / 45;
        y += k * k * 220;
      }

      if (sim.kind[i] === 1) {
        const dm = this.decoys[sd];
        if (!dm || dcounts[sd] >= MAX_DECOYS) continue;
        this.writeMatrix(dm.instanceMatrix.array as Float32Array, dcounts[sd]++, x, y, z, vx, vz, 1.1);
        continue;
      }
      if (decim > 1 && i % decim !== 0) continue;
      const mesh = this.drones[sd];
      if (!mesh) continue;
      const k = counts[sd]++;
      const mode = sim.mode[i];
      this.writeMatrix(mesh.instanceMatrix.array as Float32Array, k, x, y, z, vx, vz, mode === 2 ? 1.7 : 1.35);

      // color
      c.copy(this.colors[sd]).multiplyScalar(BRIGHT[i]);
      if (mode === 2) c.copy(HOT).multiplyScalar(1.4);
      else if (mode === 1) c.multiplyScalar(0.5);
      if (shieldOn[sd]) c.lerp(WHITE, 0.3);
      if (age < 30 && sim.born[i] >= 0) c.lerp(LIME, 0.5 * (1 - age / 30)).multiplyScalar(1.3);
      if (tick - sim.hitTick[i] <= 1) c.lerp(WHITE, 0.65);
      if (sim.stun[i] > 0 && ((t * 20) | 0) % 2 === 0) c.multiplyScalar(0.25);
      const ca = mesh.instanceColor?.array as Float32Array;
      ca[k * 3] = c.r;
      ca[k * 3 + 1] = c.g;
      ca[k * 3 + 2] = c.b;

      // trail
      if (this.trails.visible) {
        const len = mode === 2 ? 7 : 4.5;
        const o = trailN * 6;
        this.trailPos[o] = x;
        this.trailPos[o + 1] = y;
        this.trailPos[o + 2] = z;
        this.trailPos[o + 3] = x - vx * len;
        this.trailPos[o + 4] = y + (age < 45 && sim.born[i] >= 0 ? 30 : 0);
        this.trailPos[o + 5] = z - vz * len;
        const br = mode === 2 ? 0.9 : 0.42;
        this.trailCol[o] = c.r * br;
        this.trailCol[o + 1] = c.g * br;
        this.trailCol[o + 2] = c.b * br;
        this.trailCol[o + 3] = 0;
        this.trailCol[o + 4] = 0;
        this.trailCol[o + 5] = 0;
        trailN++;
      }

      // tracers for shots fired in the last step
      const st = sim.shotTick[i];
      if (tick - st <= 1 && tracerN < MAX_TRACERS) {
        const tg = sim.shotT[i];
        if (tg >= 0) {
          const tx = (sim.px[tg] + (sim.x[tg] - sim.px[tg]) * alpha) * INV;
          const tz = (sim.pz[tg] + (sim.z[tg] - sim.pz[tg]) * alpha) * INV;
          const ty = ALT[tg] + Math.sin(t * 2.1 + tg * 0.73) * 3;
          const o = tracerN * 6;
          this.tracerPos[o] = x;
          this.tracerPos[o + 1] = y;
          this.tracerPos[o + 2] = z;
          this.tracerPos[o + 3] = tx;
          this.tracerPos[o + 4] = ty;
          this.tracerPos[o + 5] = tz;
          const base = this.colors[sd];
          const fade = tick - st === 0 ? 1 : 0.45;
          this.tracerCol[o] = (base.r * 0.5 + 0.5) * fade;
          this.tracerCol[o + 1] = (base.g * 0.5 + 0.5) * fade;
          this.tracerCol[o + 2] = (base.b * 0.5 + 0.5) * fade;
          this.tracerCol[o + 3] = base.r * 0.25 * fade;
          this.tracerCol[o + 4] = base.g * 0.25 * fade;
          this.tracerCol[o + 5] = base.b * 0.25 * fade;
          tracerN++;
        }
      }
    }

    for (let s = 0; s < this.drones.length; s++) {
      const m = this.drones[s];
      m.count = counts[s];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      const dm = this.decoys[s];
      dm.count = dcounts[s];
      dm.instanceMatrix.needsUpdate = true;
    }
    this.trailGeo.setDrawRange(0, trailN * 2);
    (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.tracerGeo.setDrawRange(0, tracerN * 2);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // shields
    for (let s = 0; s < 2; s++) {
      const S = sim.s[s];
      const sh = this.shields[s];
      if (S.shield > 0 && S.count > 0) {
        sh.visible = true;
        const r = 70 + Math.sqrt(S.count) * 11;
        sh.position.set(S.cx * INV, 30, S.cz * INV);
        sh.scale.set(r, r * 0.45, r);
        sh.rotation.y += dt * 0.4;
        const mat = sh.material as THREE.MeshBasicMaterial;
        mat.color.copy(this.colors[s]);
        mat.opacity = Math.min(1, S.shield / 20) * 0.35;
      } else sh.visible = false;
    }

    // particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.pLife[i];
      if (life <= 0) {
        if (this.pAlpha[i] !== 0) {
          this.pAlpha[i] = 0;
          this.pSize[i] = 0;
        }
        continue;
      }
      const nl = life - dt;
      this.pLife[i] = nl;
      const k = Math.max(0, nl / this.pMax[i]);
      const o = i * 3;
      this.pVel[o] *= 0.95;
      this.pVel[o + 1] = this.pVel[o + 1] * 0.95 - 40 * dt;
      this.pVel[o + 2] *= 0.95;
      this.pPos[o] += this.pVel[o] * dt;
      this.pPos[o + 1] = Math.max(1, this.pPos[o + 1] + this.pVel[o + 1] * dt);
      this.pPos[o + 2] += this.pVel[o + 2] * dt;
      this.pCol[o] = this.pBase[o];
      this.pCol[o + 1] = this.pBase[o + 1];
      this.pCol[o + 2] = this.pBase[o + 2];
      this.pAlpha[i] = k;
      this.pSize[i] = this.pSize0[i] * (0.6 + 0.6 * k);
    }
    for (const name of ["position", "pcolor", "psize", "palpha"]) {
      (this.pGeo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
    }

    // rings / beams
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.set(rad, 1, rad);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / 1.2;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const wdt = 6 + 20 * (1 - k);
      b.mesh.scale.set(wdt, 320, wdt);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
    }

    // camera + shake
    this.controls.update();
    let ox = 0;
    let oy = 0;
    if (this.shakeAmp > 0.05) {
      ox = (Math.random() - 0.5) * this.shakeAmp;
      oy = (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.x += ox;
      this.camera.position.y += oy;
      this.shakeAmp *= 0.9;
    }
    const r0 = performance.now();
    if (this.quality >= 2) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.adapt(performance.now() - r0, dt);
    this.camera.position.x -= ox;
    this.camera.position.y -= oy;
  }

  private adapt(renderMs: number, dt: number): void {
    // frame cost = render time, or the real frame interval when the GPU pipeline is backed up
    const cost = Math.max(renderMs, dt * 1000 - 4);
    this.emaMs = this.emaMs * 0.9 + cost * 0.1;
    if (this.emaMs > 38) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 20 && this.quality > 0) {
      this.setQuality(this.quality - 1);
      this.slowFrames = 0;
      this.emaMs = 20;
    }
  }

  setQuality(q: number): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    if (q <= 1) this.renderer.setPixelRatio(Math.min(dpr, 1));
    if (q <= 0) {
      this.renderer.setPixelRatio(Math.min(dpr, 0.7));
      this.trails.visible = false;
      this.decim = 2;
    }
    this.resize();
  }

  private writeMatrix(arr: Float32Array, k: number, x: number, y: number, z: number, vx: number, vz: number, s: number): void {
    const l = Math.sqrt(vx * vx + vz * vz);
    let c = 1;
    let sn = 0;
    if (l > 1e-4) {
      c = vx / l;
      sn = -vz / l;
    }
    const o = k * 16;
    arr[o] = c * s;
    arr[o + 1] = 0;
    arr[o + 2] = -sn * s;
    arr[o + 3] = 0;
    arr[o + 4] = 0;
    arr[o + 5] = s;
    arr[o + 6] = 0;
    arr[o + 7] = 0;
    arr[o + 8] = sn * s;
    arr[o + 9] = 0;
    arr[o + 10] = c * s;
    arr[o + 11] = 0;
    arr[o + 12] = x;
    arr[o + 13] = y;
    arr[o + 14] = z;
    arr[o + 15] = 1;
  }

  dispose(): void {
    this.disposed = true;
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else mat?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
