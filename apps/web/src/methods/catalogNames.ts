/**
 * Payment method names from the bundled catalog (`data/payment-methods.json`, the same file the API
 * reads), by method id. Review M2 (instr-hash, lead's call): the trade screens name the method of
 * the moderator-attested id from here, never from the API view's profile, so the method a buyer is
 * told to pay with is the one signed for the trade.
 */
import catalog from '../../../../data/payment-methods.json';

const NAMES: ReadonlyMap<string, string> = new Map(
  (catalog as { methods: Array<{ id: unknown; name: unknown }> }).methods.flatMap((m) =>
    typeof m.id === 'string' && typeof m.name === 'string' && m.name !== '' ? [[m.id, m.name] as const] : [],
  ),
);

/** The catalog's name for `methodId`, or the id itself when the catalog has no such method. */
export function catalogMethodName(methodId: string): string {
  return NAMES.get(methodId) ?? methodId;
}
