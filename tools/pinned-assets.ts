// Third-party files the web app serves as they are (never bundled), copied from node_modules and
// checked byte for byte against a SHA-256 manifest computed from the pinned npm tarballs themselves,
// not from node_modules, so the check proves something about node_modules. Changing a pin means
// regenerating its manifest in the same commit. Used by tools/copy-ocr-assets.ts (Plan 5 Task 13)
// and tools/copy-monero-worker.ts (Gap 1); every vite build runs both (apps/web/vite.config.ts).
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface PinnedAsset {
  /** Path under node_modules. */
  from: string;
  /** The served file name in the output folder. */
  to: string;
}

export interface PinnedSet {
  /** Prefix of every error, e.g. `ocr-assets`. */
  label: string;
  /** The manifest file (`sha256sum` format). */
  manifest: string;
  assets: ReadonlyArray<PinnedAsset>;
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const named = (set: PinnedSet): string => `tools/${basename(set.manifest)}`;

/** The manifest as served name → SHA-256 (`sha256sum` format: "<hex>  <name>"). */
export async function readPinnedManifest(set: Pick<PinnedSet, 'label' | 'manifest'>): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const raw of (await readFile(set.manifest, 'utf8')).split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (!match) throw new Error(`${set.label}: bad manifest line: ${line}`);
    m.set(match[2]!, match[1]!);
  }
  return m;
}

/** Throws unless `outDir` holds exactly the manifest's files, each with its SHA-256. */
export async function verifyPinned(set: PinnedSet, outDir: string, manifest?: Map<string, string>): Promise<void> {
  const m = manifest ?? (await readPinnedManifest(set));
  const present = new Set(await readdir(outDir).catch(() => [] as string[]));
  for (const [name, hash] of m) {
    if (!present.has(name)) throw new Error(`${set.label}: ${name} is missing from ${outDir}`);
    if (sha256(await readFile(join(outDir, name))) !== hash) throw new Error(`${set.label}: ${name} does not match ${named(set)}`);
  }
  for (const name of present) if (!m.has(name)) throw new Error(`${set.label}: ${name} in ${outDir} is not in ${named(set)}`);
}

/**
 * Checks every source file against the manifest before writing anything, then writes only what is
 * missing or different (through a temporary file and a rename, so parallel builds never see half a
 * file), and finally verifies the whole folder.
 */
export async function copyPinned(set: PinnedSet, o: { nodeModules: string; outDir: string }): Promise<void> {
  const m = await readPinnedManifest(set);
  const sources = await Promise.all(
    set.assets.map(async (a) => {
      const bytes = await readFile(join(o.nodeModules, a.from));
      if (sha256(bytes) !== m.get(a.to)) throw new Error(`${set.label}: ${a.from} (served as ${a.to}) does not match ${named(set)}`);
      return { ...a, bytes };
    }),
  );
  await mkdir(o.outDir, { recursive: true });
  for (const s of sources) {
    const dest = join(o.outDir, s.to);
    const current = await readFile(dest).catch(() => null);
    if (current !== null && sha256(current) === m.get(s.to)) continue;
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, s.bytes);
    await rename(tmp, dest).catch(async (e: unknown) => {
      await rm(tmp, { force: true });
      throw e;
    });
  }
  await verifyPinned(set, o.outDir, m);
}
