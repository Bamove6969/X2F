import { Route, Routes } from 'react-router';
import { Disputes } from './screens/Disputes.js';
import { Feedback } from './screens/Feedback.js';
import { Invite } from './screens/Invite.js';
import { Login } from './screens/Login.js';
import { NewsEditor } from './screens/NewsEditor.js';
import { OwnerAlerts } from './screens/OwnerAlerts.js';
import { OwnerSetup } from './screens/OwnerSetup.js';
import { Prices } from './screens/Prices.js';
import { StaffList } from './screens/StaffList.js';
import { StaffOverview } from './screens/StaffOverview.js';
import { StaffPerformance } from './screens/StaffPerformance.js';
import { StaffSettings } from './screens/StaffSettings.js';
import { StaffShell } from './ui/StaffShell.js';

/**
 * The staff app (Plan 4 Task 16): Login, invite acceptance and owner setup outside the shell;
 * every other path is the shell, which shows the signed-in role's pages: the owner's Overview, Staff
 * and Settings (Task 17), Disputes (Task 18), Performance (Task 20), Prices and Feedback. Pages a
 * later task builds (Task 19) show their title until then.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/setup" element={<OwnerSetup />} />
      <Route path="/*" element={<StaffShell pages={{ overview: <Overview />, disputes: <Disputes />, staff: <StaffList />, performance: <StaffPerformance />, settings: <StaffSettings />, prices: <Prices />, feedback: <Feedback /> }} notifications={<OwnerAlerts />} />} />
    </Routes>
  );
}

/**
 * Overview (board StaffOverview, Task 17) and, under it, the owner's News editor, which no board
 * places yet: under Overview, next to the banner, is a landing default (DESIGNER-REVIEW, OWNER-Q).
 */
function Overview() {
  return (
    <Routes>
      <Route index element={<StaffOverview />} />
      <Route path="news" element={<NewsEditor />} />
    </Routes>
  );
}
