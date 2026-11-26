import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';
import { runConfirmedLocalPurge } from './chat/localPurge.js';
import { installPrimaryLabelFit } from './ui/fitPrimaryLabels.js';

async function start(): Promise<void> {
  // Constant-folded: a production build drops this branch and the fixtures module with it.
  if (__X2F_FIXTURES__) {
    const { installFixtures } = await import('./fixtures/index.js');
    installFixtures();
  }
  // Plan 7 Task 3: a trade that self-destructed while the app was closed goes from this device too,
  // by the server's clock and only once the server confirms it (never the device clock alone).
  void runConfirmedLocalPurge();
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  // DESIGN: owner 17 Nov button labels: the orange buttons' labels fill the button (ui/fitPrimaryLabels.ts).
  installPrimaryLabelFit();
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
