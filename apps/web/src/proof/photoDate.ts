// The proof's own date (owner G16, 2026-11-07), read on the poster's device BEFORE the picture is
// cleaned or re-encoded (`cleanImage`, `reencodeImage`), which drop every metadata block. Only the
// time leaves the device, as UTC to the second (`proof.attached` `photoTakenAt`); the Exif itself is
// never sent. Plan 5 Task 15 owes the call: `takenAt = await photoTakenAt(file)` on the file the
// poster picked, then `uploadPrompts(words, expected, manual, takenAt && new Date(takenAt))` (its
// `date` is `proofDate`'s verdict) with `posterDateLine(date)` for the warning, and it as
// `photoTakenAt` in the sealed payload.
import { type PhotoTime, readPhotoTimeFrom, toUtcSecond } from '@x2f/proof';

/**
 * The photo's time as a UTC instant. A photo that carries its own offset is exact. One without (most
 * screenshots) is read in this device's time zone: the poster most likely took it on this device.
 */
export function photoTimeToUtc(t: PhotoTime): string {
  const ms =
    t.offsetMinutes !== null
      ? Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - t.offsetMinutes * 60_000
      : new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second).getTime();
  return toUtcSecond(new Date(ms));
}

/**
 * When the picked picture was made, from its own metadata, as UTC (`2026-10-16T12:32:05Z`), or null.
 * Reads the file in slices: only its block headers and metadata blocks, never the image data
 * (`readPhotoTimeFrom`, at most 1 MB; review 2026-11-10).
 */
export async function photoTakenAt(file: Blob): Promise<string | null> {
  try {
    const t = await readPhotoTimeFrom(file.size, async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()));
    return t === null ? null : photoTimeToUtc(t);
  } catch {
    return null;
  }
}
