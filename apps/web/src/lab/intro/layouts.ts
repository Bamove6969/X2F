// The intro lab's block layouts (owner's proof of concept, /lab/intro, demo builds only). Pure: where
// each of the 27 blocks sits in each scene, which colour role it has, and the tween between two
// scenes. The same block (same index) moves from one scene to the next, so a change of scene is a
// morph, not a cut. Units are block widths; y is up.

export type Role = 'base' | 'escrow' | 'monero';

export interface Block {
  x: number;
  y: number;
  z: number;
  role: Role;
  /** 1 is a full block; 0 is gone. */
  scale: number;
}

export const BLOCKS = 27;
/** Centre-to-centre distance of neighbouring blocks: a block plus a hairline gap. */
export const PITCH = 1.08;

const at = (x: number, y: number, z: number, role: Role = 'base', scale = 1): Block => ({ x: x * PITCH, y: y * PITCH, z: z * PITCH, role, scale });

/** Bottom to top, then back to front, then left to right: so neighbouring blocks travel short ways. */
function ordered(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
}

/** Scene 1: the 3×3×3 cube, its top front corner in Monero orange. */
function cube(): Block[] {
  const out: Block[] = [];
  for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const x of [-1, 0, 1]) out.push(at(x, y, z, x === 1 && y === 1 && z === 1 ? 'monero' : 'base'));
  return ordered(out);
}

/** Scene 2: the cube split into three 3×3 slabs, pulled apart into a stepped stack; the top slab is escrow teal. */
function stack(): Block[] {
  const out: Block[] = [];
  [-1, 0, 1].forEach((layer) => {
    for (const z of [-1, 0, 1]) {
      for (const x of [-1, 0, 1]) {
        const b = at(x, layer, z, layer === 1 ? 'escrow' : 'base');
        // Each slab rises by half a block more and steps back by a third: a stack, not a cube.
        out.push({ ...b, y: b.y * 1.75, x: b.x - layer * 0.35, z: b.z - layer * 0.35 });
      }
    }
  });
  return ordered(out);
}

/**
 * Scene 3: a padlock of blocks. Body 5 wide × 3 high, with a back row on its bottom line; shackle of
 * two posts and a bar (escrow teal); keyhole in Monero orange, set in.
 */
function lock(): Block[] {
  const out: Block[] = [];
  for (const y of [-2, -1, 0]) {
    for (const x of [-2, -1, 0, 1, 2]) {
      const keyhole = x === 0 && y === -1;
      const b = at(x, y, 0, keyhole ? 'monero' : 'base');
      out.push(keyhole ? { ...b, z: b.z - 0.3 * PITCH } : b);
    }
  }
  for (const x of [-2, -1, 0, 1, 2]) out.push(at(x, -2, -1));
  for (const y of [1, 2]) for (const x of [-1, 1]) out.push(at(x, y, 0, 'escrow'));
  for (const x of [-1, 0, 1]) out.push(at(x, 3, 0, 'escrow'));
  // Lift the whole lock so it sits centred like the cube.
  return ordered(out.map((b) => ({ ...b, y: b.y - 0.5 * PITCH })));
}

/** The three scenes, in tour order. */
export const SCENES: readonly Block[][] = [cube(), stack(), lock()];

/** Where the blocks start before scene 1 assembles them: thrown outwards and shrunk, deterministically. */
export function scattered(): Block[] {
  return SCENES[0]!.map((b, i) => {
    const spin = (i * 2.399963) % (2 * Math.PI); // the golden angle: spread, never random
    const lift = ((i * 7) % 5) - 2;
    return { x: b.x * 2.4 + Math.cos(spin) * 1.6, y: b.y * 2.4 + lift * 0.6, z: b.z * 2.4 + Math.sin(spin) * 1.6, role: b.role, scale: 0.35 };
  });
}

/** Ease in and out (cubic): a quick move that starts and lands softly. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** The blocks at `t` (0..1, already eased) of the way from `a` to `b`; roles switch half way. */
export function mix(a: readonly Block[], b: readonly Block[], t: number): Block[] {
  return a.map((from, i) => {
    const to = b[i]!;
    const l = (p: number, q: number) => p + (q - p) * t;
    return { x: l(from.x, to.x), y: l(from.y, to.y), z: l(from.z, to.z), scale: l(from.scale, to.scale), role: t < 0.5 ? from.role : to.role };
  });
}
