import { Route, Routes } from 'react-router';
import { useMe } from '../ui/StaffShell.js';
import { LimitRecommendations } from './LimitRecommendations.js';
import { ModCase } from './ModCase.js';
import { ModQueue } from './ModQueue.js';
import { ReviewDisputes } from './ReviewDisputes.js';

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
      {/* Plan 4 Task 26: recommended account limits (no board; under Disputes is a lead default). */}
      <Route path="limits" element={<LimitRecommendations role={who.role} />} />
      {/* Plan 5 Task 19: review disputes (perm reputation.review), under Disputes (lead default, DESIGNER-REVIEW). */}
      <Route path="reviews" element={<ReviewDisputes />} />
      <Route path=":code" element={<ModCase role={who.role} me={who.displayName} />} />
    </Routes>
  );
}
