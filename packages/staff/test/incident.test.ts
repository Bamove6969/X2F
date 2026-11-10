import { describe, expect, it } from 'vitest';
import { INCIDENT_ALPHABET, incidentCheckChar, isIncidentId, normalizeIncidentId } from '../src/incident.js';

describe('incident IDs (G37)', () => {
  it('accepts nine alphabet characters whose last is the Luhn mod 32 check of the first eight', () => {
    const id = `K7QM4T2X${incidentCheckChar('K7QM4T2X')}`;
    expect(isIncidentId(id)).toBe(true);
    // Any single-character change in the payload is caught.
    for (let i = 0; i < 8; i++) {
      for (const ch of INCIDENT_ALPHABET) {
        if (ch === id[i]) continue;
        expect(isIncidentId(id.slice(0, i) + ch + id.slice(i + 1)), `${i}:${ch}`).toBe(false);
      }
    }
    // So is swapping two neighbours that differ.
    expect(isIncidentId(`7KQM4T2X${id[8]}`)).toBe(false);
  });

  it('refuses other shapes', () => {
    for (const bad of ['', 'K7QM4T2X', 'K7QM4T2XAB', 'k7qm4t2xa', 'K7QM4T2XU', 'K7QM-4T2X', 5, null]) expect(isIncidentId(bad)).toBe(false);
  });

  it('reads a typed ID: case, spaces and hyphens ignored, I and L as 1, O as 0', () => {
    const id = `10QM4T2X${incidentCheckChar('10QM4T2X')}`;
    expect(normalizeIncidentId(` lo qm-4t2x${id[8]!.toLowerCase()} `)).toBe(id);
    expect(normalizeIncidentId('IOQM4T2X' + id[8])).toBe(id);
    expect(normalizeIncidentId('nonsense')).toBeNull();
    expect(normalizeIncidentId('x'.repeat(40))).toBeNull();
  });

  it('the check character of the empty payload and of all zeros is 0', () => {
    expect(incidentCheckChar('')).toBe('0');
    expect(incidentCheckChar('00000000')).toBe('0');
  });
});
