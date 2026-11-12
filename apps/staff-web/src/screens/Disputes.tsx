import { Route, Routes } from 'react-router';
import { useMe } from '../ui/StaffShell.js';
import { ModCase } from './ModCase.js';
import { ModQueue } from './ModQueue.js';

/**
 * The Disputes page (Plan 4 Task 18): the queue at /disputes and a case at /disputes/:code. The shell
 * shows it only to roles whose nav has Disputes (owner, senior, mod: perm disputes.handle) and hands
 * it the role it read (review I3: no second `GET /staff/v1/me`, so no way to be left loading), so
 * each screen offers only what that role may do (the API checks every call too).
 */
export function Disputes() {
  const who = useMe();
  // Only outside the shell (never in the app): nothing to show without the role.
  if (who === null) return null;
  return (
    <Routes>
      <Route index element={<ModQueue role={who.role} />} />
      <Route path=":code" element={<ModCase role={who.role} />} />
    </Routes>
  );
}
