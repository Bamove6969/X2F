/**
 * "Test this key now" (owner demo note #94, 16 Nov 2026: "there is no confirmation screen when you
 * setup your security key ... it should even have you test it after adding it to make sure it
 * functions correctly"). Shown once a security key is added (sign-up's key step and Settings →
 * Security): a real WebAuthn assertion by that key alone (`testWebAuthnKey` in @x2f/auth-client,
 * the confirm ceremony and the server's own assertion check, for the `key-test` action, which earns
 * no token: security review L1), with the result inline. Nothing is
 * changed by a test, passed or not. DESIGN: wording and look. COPY-UNSIGNED
 */
import { useState } from 'react';
import { AuthApiError, KeyTestError, testWebAuthnKey, type AuthenticationCeremony } from '@x2f/auth-client';
import { KEY_TEST_RECOVERY, RECOVERY_SESSION_CODE } from '../../ui/cantDoCodes.js';
import { Button } from '../../ui/Button.js';
import { authApi } from './authApi.js';
import { keyErrorText } from './keyErrors.js';

// COPY-UNSIGNED
export const KEY_TEST_COPY = {
  button: 'Test this key now',
  again: 'Test it again',
  waiting: 'Tap your security key now. Plug it in or hold it to your phone first.',
  passed: 'Your security key works. It answered and X2F checked its answer.',
  otherKey: 'A different key answered. Test again with the key you just added.',
  notListed: 'This key did not answer the test. Reload the page and test it again.',
  failed: 'The test did not pass. Try again.',
} as const;

/** The sentence for a test that did not pass. */
export function keyTestErrorText(e: unknown): string {
  if (e instanceof KeyTestError) return e.code === 'other-key' ? KEY_TEST_COPY.otherKey : KEY_TEST_COPY.notListed;
  // Review L1: a backup (recovery) session confirms nothing, so it cannot run the test.
  if (e instanceof AuthApiError && e.code === RECOVERY_SESSION_CODE) return KEY_TEST_RECOVERY;
  return keyErrorText(e, 'security-key', KEY_TEST_COPY.failed);
}

type Result = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok' } | { kind: 'fail'; text: string };

/** The test button and its result, for the key `credentialId` just added. `ceremony` is for tests. */
export function KeyTest({ credentialId, ceremony }: { credentialId: string; ceremony?: AuthenticationCeremony }) {
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const run = async () => {
    setResult({ kind: 'busy' });
    try {
      await testWebAuthnKey(authApi, credentialId, ceremony);
      setResult({ kind: 'ok' });
    } catch (e) {
      setResult({ kind: 'fail', text: keyTestErrorText(e) });
    }
  };
  return (
    <div className="x2f-stack" data-part="key-test">
      <Button variant="secondary" disabled={result.kind === 'busy'} onClick={() => void run()} data-part="key-test-run">
        {result.kind === 'idle' || result.kind === 'busy' ? KEY_TEST_COPY.button : KEY_TEST_COPY.again}
      </Button>
      {result.kind === 'busy' ? (
        <p className="x2f-note" role="status" data-part="key-test-result" data-result="waiting">
          {KEY_TEST_COPY.waiting}
        </p>
      ) : null}
      {result.kind === 'ok' ? (
        <p className="x2f-note" role="status" data-tone="escrow" data-part="key-test-result" data-result="ok">
          {KEY_TEST_COPY.passed}
        </p>
      ) : null}
      {result.kind === 'fail' ? (
        <p className="x2f-error" role="alert" data-part="key-test-result" data-result="fail">
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
