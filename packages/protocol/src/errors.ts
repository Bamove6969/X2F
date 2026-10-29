export type ProtocolErrorCode =
  | 'bad-signature'
  | 'not-participant'
  | 'wrong-trade'
  | 'replay'
  | 'not-for-me'
  | 'too-large';

/** Every rejection of an untrusted envelope. Messages name fields, never values. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}
