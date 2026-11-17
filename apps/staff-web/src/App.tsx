import { Link, Route, Routes } from 'react-router';
import { Feedback } from './screens/Feedback.js';
import { Invite } from './screens/Invite.js';
import { Login } from './screens/Login.js';
import { NewsEditor } from './screens/NewsEditor.js';
import { OwnerAlerts } from './screens/OwnerAlerts.js';
import { OwnerSetup } from './screens/OwnerSetup.js';
import { Prices } from './screens/Prices.js';
import { Revenue } from './screens/Revenue.js';
import { StaffGrants } from './screens/StaffGrants.js';
import { PageTitle, StaffShell } from './ui/StaffShell.js';

/**
 * The staff app (Plan 4 Task 16): Login, invite acceptance and owner setup outside the shell;
 * every other path is the shell, which shows the signed-in role's pages. Pages a later task builds
 * (Tasks 17-20) show their title until then.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/setup" element={<OwnerSetup />} />
      <Route path="/*" element={<StaffShell pages={{ overview: <Overview />, staff: <StaffGrants />, prices: <Prices />, feedback: <Feedback /> }} notifications={<OwnerAlerts />} />} />
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
            {/* NEEDS_DESIGN_REVENUE: no board places the books (StaffOverview's revenue card is
                design's to draw); under Overview, the owner's alone, next to News, until then.
                DESIGN: needs drawing COPY-UNSIGNED */}
            <p className="x2f-staff-page__lead">
              <Link className="x2f-link" to="/overview/revenue">
                Revenue
              </Link>
            </p>
          </PageTitle>
        }
      />
      <Route path="news" element={<NewsEditor />} />
      <Route path="revenue" element={<Revenue />} />
    </Routes>
  );
}
