/** The Jabber set-up's write routes (jabber/routes.ts), here so auth/hold.ts can list them without an import cycle. */
export const JABBER_WRITE_ROUTES = [
  'POST /v1/account/jabber/test',
  'POST /v1/account/jabber/verify',
  'PUT /v1/account/jabber/enabled',
  'DELETE /v1/account/jabber',
] as const;
