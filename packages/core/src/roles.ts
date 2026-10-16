export type Role = 'buyer' | 'seller' | 'mod';

export const ROLES: readonly Role[] = Object.freeze(['buyer', 'seller', 'mod'] as const);
