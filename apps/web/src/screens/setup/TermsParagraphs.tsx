import { Fragment } from 'react';
import { paragraphText, type TermsParagraph } from './termsText.js';

/**
 * A Terms section's paragraphs, each a `.x2f-terms__p`, with a paragraph's bullets (owner demo notes
 * 13 Nov) as a list right after it. Shared by the trader's Terms screen and the staff invite's.
 */
export function TermsParagraphs({ paragraphs }: { paragraphs: readonly TermsParagraph[] }) {
  return (
    <>
      {paragraphs.map((p) => (
        <Fragment key={paragraphText(p)}>
          <p className="x2f-terms__p">{paragraphText(p)}</p>
          {typeof p === 'string' ? null : (
            <ul className="x2f-terms__bullets">
              {p.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </Fragment>
      ))}
    </>
  );
}
