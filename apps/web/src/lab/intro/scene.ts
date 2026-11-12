// The intro lab's Three.js scene (/lab/intro, demo builds only): an isometric (orthographic) view of
// 27 soft-shaded rounded blocks that morph from one layout to the next (layouts.ts). Loaded lazily by
// IntroLab.tsx, so Three.js is its own chunk. No textures, no shaders of our own, no eval: it runs
// under the app's CSP unchanged (script-src 'self' 'wasm-unsafe-eval').
//
// The canvas reports its state for the e2e check: data-intro-scene (ready), data-step, data-settled
// (the morph has landed) and data-painted (the share of the canvas the blocks cover, read back once
// each morph lands).
import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh, MeshStandardMaterial, Object3D, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCKS, SCENES, ease, mix, scattered, type Block, type Role } from './layouts.js';

/** The app's theme colours (tokens.css), read by IntroLab.tsx from the page. */
export interface IntroColors {
  base: string;
  escrow: string;
  monero: string;
  ground: string;
  ink: string;
}

export interface IntroScene {
  show(step: number): void;
  dispose(): void;
}

/** How long one scene takes to become the next. */
export const MORPH_MS = 900;
/** Half the height of the view, in block units: the lock (the tallest scene) fits with room. */
const VIEW = 4.4;

export function startIntroScene(canvas: HTMLCanvasElement, colors: IntroColors, reduced: boolean): IntroScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(colors.ground), 0);

  const scene = new Scene();
  const camera = new OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 0.1, 100);
  // Isometric: the camera on the cube's diagonal, a little lower than true iso for a friendlier top.
  camera.position.set(10, 8.2, 10);
  camera.lookAt(0, 0, 0);

  // Soft shading: a sky light tinted with escrow teal over the ground colour, and one key light from
  // the upper left. Faces then shade from light to dark like a gradient, with no texture.
  // The base blocks are lifted a little toward the ink colour, so they stand off the ground colour.
  const role: Record<Role, Color> = { base: new Color(colors.base).lerp(new Color(colors.ink), 0.08), escrow: new Color(colors.escrow), monero: new Color(colors.monero) };
  const sky = new Color(colors.ink).lerp(role.escrow, 0.35);
  scene.add(new HemisphereLight(sky, new Color(colors.ground), 1.6));
  const key = new DirectionalLight(new Color(colors.ink), 1.5);
  key.position.set(-4, 10, 6);
  scene.add(key, new AmbientLight(new Color(colors.ink), 0.25));

  const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.16);
  const material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
  const mesh = new InstancedMesh(geometry, material, BLOCKS);
  const group = new Group();
  group.add(mesh);
  scene.add(group);

  const dummy = new Object3D();
  const tint = new Color();

  function place(from: readonly Block[], to: readonly Block[], t: number): void {
    const now = mix(from, to, t);
    now.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(Math.max(0.0001, b.scale));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.lerpColors(role[from[i]!.role], role[to[i]!.role], t));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function resize(): void {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = -VIEW * aspect;
    camera.right = VIEW * aspect;
    camera.top = VIEW;
    camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
  }

  /** The share of the canvas the blocks cover (alpha above zero), sampled every 4th pixel. */
  function painted(): number {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let hit = 0;
    let all = 0;
    for (let i = 3; i < px.length; i += 16) {
      all++;
      if (px[i]! > 0) hit++;
    }
    return all === 0 ? 0 : hit / all;
  }

  let current: Block[] = scattered();
  let from: Block[] = current;
  let to: Block[] = current;
  let started = 0;
  let frame = 0;

  function draw(t: number): void {
    place(from, to, t);
    renderer.render(scene, camera);
  }

  function settle(): void {
    current = to;
    draw(1);
    canvas.dataset.painted = painted().toFixed(3);
    canvas.dataset.settled = 'true';
  }

  function tick(now: number): void {
    const t = ease((now - started) / MORPH_MS);
    current = mix(from, to, t);
    if (t >= 1) {
      frame = 0;
      settle();
      return;
    }
    draw(t);
    frame = requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(() => {
    resize();
    draw(canvas.dataset.settled === 'true' ? 1 : 0);
  });
  observer.observe(canvas);
  resize();
  canvas.dataset.introScene = 'ready';

  return {
    show(step) {
      const target = SCENES[Math.max(0, Math.min(SCENES.length - 1, step))]!;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      canvas.dataset.step = String(step);
      canvas.dataset.settled = 'false';
      from = current;
      to = target;
      if (reduced) {
        // No motion: the next scene is simply there.
        from = target;
        settle();
        return;
      }
      started = performance.now();
      frame = requestAnimationFrame(tick);
    },
    dispose() {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
