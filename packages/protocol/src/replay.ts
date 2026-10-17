import type { Role } from '@x2f/core';
import { hasExactKeys, isPlainObject, isRole, isValidSeq, isValidTrade } from './roles.js';

export interface ReplayGuardJSON {
  trade: string;
  seen: Partial<Record<Role, number>>;
}

/**
 * Replay protection for one trade: accepts only a strictly increasing seq per sender.
 * The trade is fixed at construction; open() rejects envelopes for any other trade
 * ('wrong-trade') and calls accept() last, only after full success.
 */
export class ReplayGuard {
  readonly #trade: string;
  readonly #seen = new Map<Role, number>();

  constructor(trade: string) {
    if (!isValidTrade(trade)) throw new TypeError('ReplayGuard: invalid trade');
    this.#trade = trade;
  }

  get trade(): string {
    return this.#trade;
  }

  /** Records and returns true only for a valid role and a strictly newer, valid seq. */
  accept(from: Role, seq: number): boolean {
    if (!isRole(from) || !isValidSeq(seq)) return false;
    const last = this.#seen.get(from);
    if (last !== undefined && seq <= last) return false;
    this.#seen.set(from, seq);
    return true;
  }

  toJSON(): ReplayGuardJSON {
    return { trade: this.#trade, seen: Object.fromEntries(this.#seen) };
  }

  static from(json: unknown): ReplayGuard {
    if (!isPlainObject(json) || !hasExactKeys(json, ['trade', 'seen'])) throw new TypeError('ReplayGuard.from: bad shape');
    const { trade, seen } = json;
    if (!isValidTrade(trade)) throw new TypeError('ReplayGuard.from: bad trade');
    if (!isPlainObject(seen) || Object.getOwnPropertySymbols(seen).length > 0) throw new TypeError('ReplayGuard.from: bad seen');
    const g = new ReplayGuard(trade);
    for (const k of Object.getOwnPropertyNames(seen)) {
      const v = seen[k];
      if (!isRole(k) || !isValidSeq(v)) throw new TypeError('ReplayGuard.from: bad seen entry');
      g.#seen.set(k, v);
    }
    return g;
  }
}
