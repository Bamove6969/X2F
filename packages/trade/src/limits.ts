/**
 * The launch cap (owner p11-6, 8 Nov: "No I would say 5000"): the most one trade may be worth for
 * the first months, in US cents, whatever anyone's stage. Enforced by the API when an offer is
 * posted (its maximum) and when one is taken (the trade's USD value). To raise it, change this
 * one number.
 */
export const LAUNCH_TRADE_CAP_USD_CENTS = 500_000n;
