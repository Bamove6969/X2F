import { pgChainReader, verifyChain, type VerifyResult } from '@x2f/logchain';
import type { Queryable } from '../db/pool.js';

export type { VerifyResult };

/**
 * Re-computes the chain (Plan 4 Task 3), through the shared `verifyChain` (@x2f/logchain, which the
 * moderation process's checkpoints use too, Task 14). Without `from` it starts at the first row
 * (whose prev_hash must be null); with a checkpoint `from` it first checks that row still has the
 * checkpoint's hash, then verifies every later row. Each row must link to the row before it (a
 * removed row breaks the next one) and its stored hash must match its contents. `brokenAt` is the
 * first row that fails.
 */
export function verifyLogChain(db: Queryable, from?: { id: string; hash: string }): Promise<VerifyResult> {
  return verifyChain(pgChainReader(db), from);
}
