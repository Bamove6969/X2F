/** Participants in an X2F escrow trade. */
export type Role = 'buyer' | 'seller' | 'mod';

/** All valid roles, frozen for runtime safety. */
export const ROLES: readonly Role[] = Object.freeze<Role[]>([
  'buyer',
  'seller',
  'mod',
]);
