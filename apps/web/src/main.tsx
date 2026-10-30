import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';
import { runLocalPurge } from './chat/localPurge.js';

async function start(): Promise<void> {
  // Constant-folded: a production build drops this branch and the fixtures module with it.
  if (__X2F_FIXTURES__) {
    const { installFixtures } = await import('./fixtures/index.js');
    installFixtures();
  }
  // Plan 7 Task 3: a trade that self-destructed while the app was closed goes from this device too
  // (its stored date is the server's; only the moment of checking is this device's clock).
  void runLocalPurge(Date.now());
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
