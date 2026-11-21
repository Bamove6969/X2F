// Plan 3 Task 31: the regtest stack the end-to-end specs run against. It is in tools/regtest/e2e,
// because it hands the moderation process its secrets and no apps/web file may name them
// (tools/separation-check.ts).
export { ROOT, startStack, type Stack, type StackInfo } from '../../../tools/regtest/e2e/stack.js';
