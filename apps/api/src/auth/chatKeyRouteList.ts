/** The chat-key courier's write routes (auth/chatKeys.ts), here so auth/hold.ts can list them without an import cycle. */
export const CHAT_KEY_WRITE_ROUTES = [
  'POST /v1/account/chat-keys',
  'DELETE /v1/account/chat-keys/:id',
] as const;
