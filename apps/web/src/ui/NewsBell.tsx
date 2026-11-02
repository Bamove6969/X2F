import { Link } from 'react-router';
import { useNewsUnseen } from '../screens/news-model.js';
import { Icon } from './icons.js';
import './ui.css';

/**
 * "Site news" (owner 29 Oct; News board): the bell beside the X2F logo that always opens News, with
 * a teal dot while something is new on this device. It is how News stays reachable after "Don't
 * show me this again" (review I3).
 */
export function NewsBell() {
  const unseen = useNewsUnseen();
  return (
    <Link to="/news" className="x2f-icon-button x2f-news-bell" aria-label={unseen > 0 ? `Site news, ${unseen} new` : 'Site news'} data-part="news-bell">
      <Icon name="bell" size={22} />
      {unseen > 0 ? <span className="x2f-news-bell__dot" aria-hidden="true" /> : null}
    </Link>
  );
}
