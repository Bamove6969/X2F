import { Route, Routes } from 'react-router';
import { Accounts } from './screens/Accounts.js';
import { Disputes } from './screens/Disputes.js';
import { Feedback } from './screens/Feedback.js';
import { Invite } from './screens/Invite.js';
import { Login } from './screens/Login.js';
import { MySecurity } from './screens/MySecurity.js';
import { NewsEditor } from './screens/NewsEditor.js';
import { OwnerAlerts } from './screens/OwnerAlerts.js';
import { OwnerSetup } from './screens/OwnerSetup.js';
import { PastRep } from './screens/PastRep.js';
import { Prices } from './screens/Prices.js';
import { Revenue } from './screens/Revenue.js';
import { StaffList } from './screens/StaffList.js';
import { StaffOverview } from './screens/StaffOverview.js';
import { StaffPerformance } from './screens/StaffPerformance.js';
import { StaffSettings } from './screens/StaffSettings.js';
import { StaffLog } from './screens/StaffLog.js';
import { Training } from './screens/Training.js';
import { TicketCase } from './screens/TicketCase.js';
import { TicketQueue } from './screens/TicketQueue.js';
import { StaffShell } from './ui/StaffShell.js';

/**
 * The staff app (Plan 4 Task 16): Login, invite acceptance and owner setup outside the shell;
 * every other path is the shell, which shows the signed-in role's pages: the owner's Overview, Staff
 * and Settings (Task 17), Disputes (Task 18), the Training library and the Activity log (Task 19),
 * Performance (Task 20), Prices, Feedback and Past reputation (Plan 5 Task 11), Accounts
 * (spec 6.6: find a trader, then ban, lift a ban or work a hold outside a case), and Tickets (Plan 4
 * Task 31: the owner's, and anyone's the owner granted `tickets.handle`, a helper's first page); every
 * role's own My security page (login methods, sessions and alerts) is linked under the nav.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/setup" element={<OwnerSetup />} />
      <Route path="/*" element={<StaffShell pages={{ overview: <Overview />, disputes: <Disputes />, 'past-reputation': <PastRep />, accounts: <Accounts />, staff: <StaffList />, performance: <StaffPerformance />, settings: <StaffSettings />, prices: <Prices />, feedback: <Feedback />, tickets: <Tickets />, training: <Training />, log: <StaffLog /> }} notifications={<OwnerAlerts />} security={<MySecurity />} />} />
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
      <Route path="revenue" element={<Revenue />} />
    </Routes>
  );
}

/** Tickets (Plan 4 Task 31): the queue at /tickets and a ticket its taker opened at /tickets/:id. */
function Tickets() {
  return (
    <Routes>
      <Route index element={<TicketQueue />} />
      <Route path=":id" element={<TicketCase />} />
    </Routes>
  );
}
