// The slice of Three.js 0.186 the intro lab uses (/lab/intro, demo builds only), typed by hand:
// @types/three would bring a physics engine, a tween library and more into the install for a proof
// of concept. Add members here as the lab needs them.
declare module 'three' {
  export class Color {
    constructor(style?: string);
    r: number;
    g: number;
    b: number;
    setStyle(style: string): this;
    lerpColors(a: Color, b: Color, t: number): this;
    lerp(c: Color, t: number): this;
    clone(): Color;
  }
  export class Matrix4 {}
  export class Object3D {
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    rotation: { x: number; y: number; z: number };
    scale: { setScalar(s: number): void };
    matrix: Matrix4;
    add(...objects: Object3D[]): this;
    lookAt(x: number, y: number, z: number): void;
    updateMatrix(): void;
  }
  export class Scene extends Object3D {}
  export class Group extends Object3D {}
  export class OrthographicCamera extends Object3D {
    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number);
    left: number;
    right: number;
    top: number;
    bottom: number;
    updateProjectionMatrix(): void;
  }
  export class BufferGeometry {
    dispose(): void;
  }
  export class MeshStandardMaterial {
    constructor(parameters?: { roughness?: number; metalness?: number });
    dispose(): void;
  }
  export class InstancedMesh extends Object3D {
    constructor(geometry: BufferGeometry, material: MeshStandardMaterial, count: number);
    instanceMatrix: { needsUpdate: boolean };
    instanceColor: { needsUpdate: boolean } | null;
    setMatrixAt(index: number, matrix: Matrix4): void;
    setColorAt(index: number, color: Color): void;
    dispose(): void;
  }
  export class HemisphereLight extends Object3D {
    constructor(sky: Color, ground: Color, intensity: number);
  }
  export class DirectionalLight extends Object3D {
    constructor(color: Color, intensity: number);
  }
  export class AmbientLight extends Object3D {
    constructor(color: Color, intensity: number);
  }
  export class WebGLRenderer {
    constructor(parameters: { canvas: HTMLCanvasElement; antialias?: boolean; alpha?: boolean; powerPreference?: 'default' | 'high-performance' | 'low-power' });
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setClearColor(color: Color, alpha: number): void;
    render(scene: Scene, camera: OrthographicCamera): void;
    getContext(): WebGLRenderingContext | WebGL2RenderingContext;
    dispose(): void;
  }
}

declare module 'three/addons/geometries/RoundedBoxGeometry.js' {
  import { BufferGeometry } from 'three';
  export class RoundedBoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number, segments?: number, radius?: number);
  }
}
