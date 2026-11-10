import type { ReactNode } from 'react';
import './staff.css';

export interface Column<R> {
  /** The header, as the board words it ("When", "What happened"). */
  title: string;
  cell: (row: R) => ReactNode;
  /** Mono cells (codes, times), as the boards set them. */
  mono?: boolean;
}

/**
 * The staff boards' table (StaffLog, StaffList, ModQueue): muted 13 px headers, rows split by a
 * `line` rule, no zebra. Used by every list page (Tasks 16-20). `empty` shows in place of the
 * rows when there are none.
 */
export function Table<R>({ columns, rows, rowKey, label, empty }: { columns: readonly Column<R>[]; rows: readonly R[]; rowKey: (row: R) => string; label: string; empty?: ReactNode }) {
  return (
    <table className="x2f-staff-table" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.title} scope="col">
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty !== undefined ? (
          <tr>
            <td colSpan={columns.length} className="x2f-staff-table__empty">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.title} data-mono={c.mono ? '' : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
