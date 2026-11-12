import type { StaffRole } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import { me } from '../api.js';
import { ModCase } from './ModCase.js';
import { ModQueue } from './ModQueue.js';

/**
 * The Disputes page (Plan 4 Task 18): the queue at /disputes and a case at /disputes/:code. The shell
 * shows it only to roles whose nav has Disputes (owner, senior, mod: perm disputes.handle); it reads
 * the role once, so each screen offers only what that role may do (the API checks every call too).
 */
export function Disputes() {
  const [role, setRole] = useState<StaffRole | null>(null);
  useEffect(() => {
    let live = true;
    me().then(
      (m) => {
        if (live) setRole(m.role);
      },
      // The shell handles a session that ended; nothing else to show without the role.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (role === null) return <div className="x2f-staff-loading" aria-busy="true" />;
  return (
    <Routes>
      <Route index element={<ModQueue role={role} />} />
      <Route path=":code" element={<ModCase role={role} />} />
    </Routes>
  );
}
