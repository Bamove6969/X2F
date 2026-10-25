// Screen harnesses for the Playwright specs, in fixture builds only (main.tsx). Each screen task
// that cannot reach its real route yet adds one <Route> here. Not in any production bundle.
import { Route, Routes } from 'react-router';
import { PayHarness } from './payHarness.js';

export function Harnesses() {
  return (
    <Routes>
      {/* Task 23: BuyerPay and SellerWaiting (e2e/pay.harness.ts). */}
      <Route path="/__harness/pay/:code" element={<PayHarness />} />
    </Routes>
  );
}
