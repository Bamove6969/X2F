/** DEMO ONLY: what the staff seed made (staff-seed.ts writes it; the guide page reads it). No secrets. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.js';

export const STAFF_SUMMARY_FILE = join(STATE_DIR, 'staff.json');

export interface StaffSummary {
  /** The staff origin (X2F_STAFF_ORIGIN). */
  origin: string;
  people: Array<{ login: string; shown: string; role: 'owner' | 'senior' | 'mod' }>;
  /** Trade codes of the open disputes in the queue. */
  disputes: string[];
  /** The ones the senior moderator took. */
  taken: string[];
  news: string;
  /** Staff pay the seed set (Settings, Staff pay). */
  pay?: string[];
  /** Rulings the seed made (pay is earned when round 1 is published). */
  ruled?: string[];
  failures: string[];
}

export function readStaffSummary(file = STAFF_SUMMARY_FILE): StaffSummary | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StaffSummary;
  } catch {
    return null;
  }
}
