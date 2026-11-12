import { Link, Route, Routes } from 'react-router';
import { Disputes } from './screens/Disputes.js';
import { Feedback } from './screens/Feedback.js';
import { Invite } from './screens/Invite.js';
import { Login } from './screens/Login.js';
import { NewsEditor } from './screens/NewsEditor.js';
import { OwnerSetup } from './screens/OwnerSetup.js';
import { PageTitle, StaffShell } from './ui/StaffShell.js';

/**
 * The staff app (Plan 4 Task 16): Login, invite acceptance and owner setup outside the shell;
 * every other path is the shell, which shows the signed-in role's pages: Disputes (Task 18) and
 * Feedback so far. Pages a later task builds (Tasks 17, 19, 20) show their title until then.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/setup" element={<OwnerSetup />} />
      <Route path="/*" element={<StaffShell pages={{ overview: <Overview />, disputes: <Disputes />, feedback: <Feedback /> }} />} />
    </Routes>
  );
}

/**
 * Overview (board StaffOverview; Task 17 builds the page). Until then it holds the way to the
 * owner's News editor, which no board places yet: under Overview, next to the banner, is a
 * landing default (DESIGNER-REVIEW, OWNER-Q).
 */
function Overview() {
  return (
    <Routes>
      <Route
        index
        element={
          <PageTitle title="Overview">
            <p className="x2f-staff-page__lead">
              <Link className="x2f-link" to="/overview/news">
                News for traders
              </Link>
            </p>
          </PageTitle>
        }
      />
      <Route path="news" element={<NewsEditor />} />
    </Routes>
  );
}
