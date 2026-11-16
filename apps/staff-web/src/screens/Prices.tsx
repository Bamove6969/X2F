import { useCallback, useEffect, useState } from 'react';
import { priceHealth, type PriceHealth } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';

// DESIGN: not drawn. The staff Prices page has no board yet (J-21; design draws it): plain kit
// pieces and StaffLog's table styles until then. Every sentence on this page is draft copy.
// COPY-UNSIGNED

/** "2026-11-10 09:58 UTC" (the staff boards' times are UTC); "Never" before a first good fetch. */
export function utcMinute(iso: string | null): string {
  if (iso === null) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

/**
 * The owner's Prices page (owner Q13, 6 Nov: the price-health page moves to the staff site; spec
 * 11.6), from `GET /staff/v1/price-health` (perm `stats.read`): each XMR price source and each
 * exchange-rate source with its last good fetch, failures in a row and whether it is in use, the
 * rates the sanity guard refused, the currencies whose market prices are paused, and the two
 * settings the guard runs on. Read once on opening and again on "Reload"; it never polls.
 */
export function Prices() {
  const [health, setHealth] = useState<PriceHealth | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setHealth(await priceHealth());
      setFault(null);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load the price health just now. Reload to try again.'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section data-screen="prices">
      <PageTitle title="Prices">
        <p className="x2f-staff-page__lead">Where X2F gets the XMR price and the exchange rates, and whether each source is working.</p>
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="prices-fault">
          {fault}
        </Notice>
      ) : null}
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>
        Reload
      </Button>
      {health !== null ? (
        <>
          <h2 className="x2f-h2">Paused currencies</h2>
          <p data-part="paused">
            {health.paused.length === 0
              ? 'No currency is paused.'
              : `Market prices are paused for ${health.paused.join(', ')}. Offers in these currencies show no price until a source works again.`}
          </p>
          <h2 className="x2f-h2">XMR price sources</h2>
          <Table
            label="XMR price sources"
            rows={health.xmr}
            rowKey={(r) => r.name}
            empty="No XMR price source is set up."
            columns={[
              { title: 'Source', cell: (r) => r.name },
              { title: 'Last good price', cell: (r) => utcMinute(r.lastGoodAt), mono: true },
              { title: 'Failures in a row', cell: (r) => String(r.consecutiveFailures), mono: true },
              { title: 'In use', cell: (r) => yesNo(r.inUse) },
            ]}
          />
          <h2 className="x2f-h2">Exchange-rate sources</h2>
          <Table
            label="Exchange-rate sources"
            rows={health.fx}
            rowKey={(r) => r.name}
            empty="No exchange-rate source is set up."
            columns={[
              { title: 'Source', cell: (r) => r.name },
              { title: 'Order', cell: (r) => String(r.rank), mono: true },
              { title: 'Last good rates', cell: (r) => utcMinute(r.lastGoodAt), mono: true },
              { title: 'Failures in a row', cell: (r) => String(r.consecutiveFailures), mono: true },
              { title: 'Out of date', cell: (r) => yesNo(r.stale) },
              { title: 'Used for', cell: (r) => (r.usedFor.length === 0 ? 'Nothing' : r.usedFor.join(', ')) },
            ]}
          />
          <h2 className="x2f-h2">Refused rates</h2>
          <Table
            label="Refused rates"
            rows={health.rejected}
            rowKey={(r) => `${r.source}:${r.currency}:${r.at}`}
            empty="No rate was refused."
            columns={[
              { title: 'Source', cell: (r) => r.source },
              { title: 'Currency', cell: (r) => r.currency, mono: true },
              { title: 'When', cell: (r) => utcMinute(r.at), mono: true },
            ]}
          />
          <p className="x2f-staff-page__lead" data-part="price-settings">
            {`Rates older than ${health.settings.staleAfterMinutes} minutes count as out of date. A rate more than ${health.settings.sanityPercent}% away from the other sources is refused.`}
          </p>
        </>
      ) : null}
    </section>
  );
}
