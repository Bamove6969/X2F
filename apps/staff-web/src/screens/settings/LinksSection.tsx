import { communityLink, moderatorContactLink } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { putLinks, settings as fetchSettings, type LinkSettings } from '../../api.js';
import { faultText, type StaffRefusal } from '../../refusals.js';
import { CantDoThat } from '../../ui/kit.js';
import { failureOf, SectionFoot, SettingField, SettingsCard } from './sectionKit.js';

/**
 * Spec 6.6 "Settings": the moderator contact link shown to banned users (D-067: Matrix preferred,
 * since it needs no phone number; Telegram allowed) and the community Matrix and Telegram links of
 * the emergency-stop message (Plan 4 Task 29). `PUT /staff/v1/settings` with the changed links only;
 * links need no tap (apps/api/src/staff/settings.ts). An empty field clears the link. Each field is
 * read by `@x2f/staff`'s own checks, the same the API applies. The API logs which link changed,
 * never its value. Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Contact and community links',
  lead: 'Banned traders see the moderator contact link. The community links show on the offer lists while new trades are paused. Leave a field empty to remove its link.',
  fields: {
    moderatorContactUrl: {
      label: 'Moderator contact',
      help: 'A Matrix link (matrix.to, preferred: it needs no phone number) or a Telegram link (t.me).',
      placeholder: 'https://matrix.to/#/@moderators:example.org',
      problem: 'Moderator contact (a matrix.to or t.me link)',
    },
    communityMatrixUrl: {
      label: 'Community on Matrix',
      help: 'The room where the channel topic has the latest information.',
      placeholder: 'https://matrix.to/#/#x2f:example.org',
      problem: 'Community on Matrix (an https link, no spaces)',
    },
    communityTelegramUrl: {
      label: 'Community on Telegram',
      help: 'The channel where the topic has the latest information.',
      placeholder: 'https://t.me/x2f',
      problem: 'Community on Telegram (an https link, no spaces)',
    },
  },
  save: 'Save links',
  loadFault: 'X2F could not load the links just now. Reload to try again.',
  saveFault: 'The links were not saved. Try again.',
} as const;

type Field = keyof LinkSettings;
const FIELDS: readonly Field[] = ['moderatorContactUrl', 'communityMatrixUrl', 'communityTelegramUrl'];

/** A field as typed: '' is no link (null); undefined when it is not a link the API takes. */
function linkOf(field: Field, typed: string): string | null | undefined {
  const t = typed.trim();
  if (t === '') return null;
  return (field === 'moderatorContactUrl' ? moderatorContactLink(t) : communityLink(t)) ?? undefined;
}

export function LinksSection() {
  const [stored, setStored] = useState<LinkSettings | null>(null);
  const [draft, setDraft] = useState<Record<Field, string>>({ moderatorContactUrl: '', communityMatrixUrl: '', communityTelegramUrl: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const show = (s: LinkSettings) => {
    const next = { moderatorContactUrl: s.moderatorContactUrl ?? null, communityMatrixUrl: s.communityMatrixUrl ?? null, communityTelegramUrl: s.communityTelegramUrl ?? null };
    setStored(next);
    setDraft({ moderatorContactUrl: next.moderatorContactUrl ?? '', communityMatrixUrl: next.communityMatrixUrl ?? '', communityTelegramUrl: next.communityTelegramUrl ?? '' });
  };
  useEffect(() => {
    fetchSettings().then(
      (s) => show(s as unknown as LinkSettings),
      (e: unknown) => setFault(faultText(e, C.loadFault)),
    );
  }, []);

  const problems: string[] = [];
  const change: Partial<LinkSettings> = {};
  for (const f of FIELDS) {
    const v = linkOf(f, draft[f]);
    if (v === undefined) problems.push(C.fields[f].problem);
    else if (stored !== null && v !== stored[f]) change[f] = v;
  }
  const canSave = stored !== null && problems.length === 0 && Object.keys(change).length > 0;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setFault(null);
    setSaved(false);
    try {
      show(await putLinks(change));
      setSaved(true);
    } catch (e) {
      const f = failureOf(e, C.saveFault);
      if ('refusal' in f) setRefusal(f.refusal);
      else setFault(f.fault);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard label={C.title} lead={C.lead} part="links">
      {FIELDS.map((f) => (
        <SettingField
          key={f}
          wide
          label={C.fields[f].label}
          help={C.fields[f].help}
          placeholder={C.fields[f].placeholder}
          value={draft[f]}
          invalid={linkOf(f, draft[f]) === undefined}
          onChange={(v) => {
            setSaved(false);
            setDraft((d) => ({ ...d, [f]: v }));
          }}
        />
      ))}
      <SectionFoot part="links" problems={stored === null ? [] : problems} fault={fault} saved={saved} saveLabel={C.save} canSave={canSave} busy={busy} onSave={() => void save()} />
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </SettingsCard>
  );
}
