import type { Role } from '@x2f/core';
import { MAX_TRADE_LEN, hasExactKeys, isPlainObject, isRole } from './roles.js';

export interface ReplayGuardJSON {
  trade: string | null;
  seen: Partial<Record<Role, number>>;
}

const validSeq = (s: unknown): s is number => typeof s === 'number' && Number.isSafeInteger(s) && s >= 0;

/**
 * Accepts only a strictly increasing seq per sender, and binds to one trade id on the first
 * accepted message. open() calls accept() last, after full success.
 */
export class ReplayGuard {
  #trade: string | null;
  readonly #seen = new Map<Role, number>();

  constructor(trade?: string) {
    if (trade !== undefined && (typeof trade !== 'string' || trade.length > MAX_TRADE_LEN)) {
      throw new TypeError('ReplayGuard: invalid trade');
    }
    this.#trade = trade ?? null;
  }

  get trade(): string | null {
    return this.#trade;
  }

  acceptsTrade(trade: string): boolean {
    return this.#trade === null || this.#trade === trade;
  }

  /** Records and returns true only for a valid, strictly newer seq (and matching trade if given). */
  accept(from: Role, seq: number, trade?: string): boolean {
    if (!isRole(from) || !validSeq(seq)) return false;
    if (trade !== undefined && !this.acceptsTrade(trade)) return false;
    const last = this.#seen.get(from);
    if (last !== undefined && seq <= last) return false;
    this.#seen.set(from, seq);
    if (trade !== undefined) this.#trade = trade;
    return true;
  }

  toJSON(): ReplayGuardJSON {
    return { trade: this.#trade, seen: Object.fromEntries(this.#seen) };
  }

  static from(json: unknown): ReplayGuard {
    if (!isPlainObject(json) || !hasExactKeys(json, ['trade', 'seen'])) throw new TypeError('ReplayGuard.from: bad shape');
    const { trade, seen } = json;
    if (trade !== null && (typeof trade !== 'string' || trade.length > MAX_TRADE_LEN)) {
      throw new TypeError('ReplayGuard.from: bad trade');
    }
    if (!isPlainObject(seen) || Object.getOwnPropertySymbols(seen).length > 0) throw new TypeError('ReplayGuard.from: bad seen');
    const g = new ReplayGuard(trade ?? undefined);
    for (const k of Object.getOwnPropertyNames(seen)) {
      const v = seen[k];
      if (!isRole(k) || !validSeq(v)) throw new TypeError('ReplayGuard.from: bad seen entry');
      g.#seen.set(k, v);
    }
    return g;
  }
}
