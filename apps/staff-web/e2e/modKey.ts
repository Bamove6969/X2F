/**
 * Design build task 9: the moderation signing key the e2e build pins (VITE_MOD_SIGNING_PUBLIC,
 * playwright.config.ts) and moderator.spec.ts signs the chat's attestation with. TEST ONLY: the
 * seed is BLAKE2b-256 of a fixed string, so the config (which cannot wait for libsodium) can hold
 * the public half as a constant; the spec derives the pair from the seed and checks it is this one.
 */
export const MOD_TEST_SEED_HEX = '8de2796cc30da9c8a5bd5c70ff66a069839b34277322d03c26521c27370f82e2';
export const MOD_TEST_SIGNING_PUBLIC = '1f9cf2c21e46ce128cdd10e6571e3f000b32f5551ef9e3f85c3d94e99bd2aa7c';
