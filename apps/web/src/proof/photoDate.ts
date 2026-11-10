// The proof's own date (owner G16, 2026-11-07), read on the poster's device BEFORE the picture is
// cleaned or re-encoded (`cleanImage`, `reencodeImage`), which drop every metadata block. Only the
// time leaves the device, as UTC to the second (`proof.attached` `takenAt`); the Exif itself is
// never sent. Plan 5 Task 15 owes the call: `takenAt = await photoTakenAt(file)` on the file the
// poster picked, then `proofDate(words, takenAt && new Date(takenAt), …)` and `posterDateLine` for
// the warning, and `takenAt` in the sealed payload.
import { type PhotoTime, readPhotoTime, toUtcSecond } from '@x2f/proof';

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

/** When the picked picture was made, from its own metadata, as UTC (`2026-10-16T12:32:05Z`), or null. */
export async function photoTakenAt(file: Blob): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
  const t = readPhotoTime(bytes);
  return t === null ? null : photoTimeToUtc(t);
}
