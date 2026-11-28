import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Owner 27 Nov (follow-up, docs/security/private-mod-chat-2026-11-27.md): @mentions in a dispute's
 * chat. Typing `@` opens a picker of the known names (the moderator's own and both traders'),
 * filtered as you type; choosing one inserts `@username `. In rendered lines `@<known name>` is
 * highlighted. Plain text only: the text is split into strings and <mark> elements, never HTML.
 */

/** The `@query` being typed just before the caret (at the start or after a space), or null. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([^\s@]*)$/u.exec(text.slice(0, caret));
  if (m === null) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

/** The known names matching `query` (case-insensitive): those starting with it first, then those containing it. */
export function mentionMatches(names: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  const known = uniqueNames(names);
  return [...known.filter((n) => n.toLowerCase().startsWith(q)), ...known.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))];
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim() !== '' && !/\s/u.test(n)))];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A mention starts where no letter, digit, `_` or `@` is just before it, and ends where no letter, digit or `_` follows. */
const NOT_AFTER = /(?<![\p{L}\p{N}_@])/u.source;
const NOT_BEFORE = /(?![\p{L}\p{N}_])/u.source;

/**
 * `text` with every `@<known name>` (not inside a word, an address or a longer name) as a
 * highlighted <mark>; the rest stays plain strings, so React escapes it.
 */
export function mentionNodes(text: string, names: readonly string[]): ReactNode[] {
  const known = uniqueNames(names).sort((a, b) => b.length - a.length);
  if (known.length === 0 || !text.includes('@')) return [text];
  const re = new RegExp(`${NOT_AFTER}@(?:${known.map(escape).join('|')})${NOT_BEFORE}`, 'giu');
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index;
    if (i > at) out.push(text.slice(at, i));
    out.push(
      <mark key={i} className="x2f-staff-mention" data-part="mention">
        {m[0]}
      </mark>,
    );
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * A textarea with the @mention picker: a listbox of the matching names under it, driven from the
 * textarea (up and down move, Enter chooses, Escape closes; the active option is the textarea's
 * aria-activedescendant), and by pointer.
 */
export function MentionTextarea({ id, names, value, onChange, className, rows, maxLength }: {
  id: string;
  names: readonly string[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  rows?: number;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  // The `@` the person closed the picker at (Escape): it stays closed until another one is typed.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const token = mentionAt(value, Math.min(caret, value.length));
  const matches = token === null ? [] : mentionMatches(names, token.query);
  const open = token !== null && token.start !== closedAt && matches.length > 0;
  const listId = `${id}-mentions`;
  const optionId = (i: number) => `${id}-mention-${i}`;
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    const el = ref.current;
    if (pendingCaret.current === null || el === null) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  });

  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);
  const choose = (name: string) => {
    if (token === null) return;
    const end = token.start + 1 + token.query.length;
    const inserted = `@${name} `;
    const next = value.slice(0, token.start) + inserted + value.slice(end);
    const at = token.start + inserted.length;
    pendingCaret.current = at;
    setCaret(at);
    setActive(0);
    onChange(next);
  };

  return (
    <div className="x2f-staff-mentions">
      <textarea
        ref={ref}
        id={id}
        className={className}
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(current) : undefined}
        onChange={(e) => {
          track(e.target);
          setActive(0);
          const t = mentionAt(e.target.value, e.target.selectionStart ?? e.target.value.length);
          if (t === null || t.start !== closedAt) setClosedAt(null);
          onChange(e.target.value);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = matches.length;
            setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(matches[current]!);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setClosedAt(token!.start);
          }
        }}
        onBlur={() => {
          if (token !== null) setClosedAt(token.start);
        }}
      />
      {open ? (
        <ul className="x2f-staff-mentions__list" id={listId} role="listbox" aria-label="Mention someone" data-part="mention-picker">
          {matches.map((n, i) => (
            <li
              key={n}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'x2f-staff-mentions__option x2f-staff-mentions__option--active' : 'x2f-staff-mentions__option'}
              // Keeps the focus in the textarea, so the caret is where the name goes.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(n)}
            >
              {`@${n}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
