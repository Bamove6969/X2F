import { Link } from 'react-router';
import { accountTypeOf, mayPostOffers, memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { ACCOUNT_TYPE_COPY, ACCOUNT_TYPE_PATH } from '../settings/accountTypeCopy.js';

// DESIGN: owner 17 Nov black+orange rule. The browse screens (payment methods, a method's offers)
// have no primary action of their own, so their orange accent is a link to the poster's way in:
// "Post an offer" (the My offers button's words), opening Post offer on this side, currency and,
// on a method's offers, that method. Only for a session that may post (the tab bar's own rule,
// session/member.ts mayPostOffers); a trader account gets My offers' way instead, "Switch to a
// vendor account"; a member without the Offers role gets neither. A link: the kit's orange.
export function PostOfferLink({ side, currency, method }: { side: 'buy' | 'sell'; currency: string; method?: string }) {
  const session = useSession();
  let link: { to: string; label: string } | null = null;
  if (mayPostOffers(session)) {
    const q = new URLSearchParams({ side, currency, ...(method !== undefined && method !== '' ? { method } : {}) });
    link = { to: `/post?${q.toString()}`, label: 'Post an offer' };
  } else if (accountTypeOf(session) === 'trader' && memberOf(session) === null) {
    link = { to: ACCOUNT_TYPE_PATH, label: ACCOUNT_TYPE_COPY.switchButton };
  }
  if (link === null) return null;
  return (
    <p className="x2f-browse__post">
      <Link className="x2f-link" to={link.to} data-part="browse-post">
        {link.label}
      </Link>
    </p>
  );
}
