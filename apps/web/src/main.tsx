import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';

async function start(): Promise<void> {
  // Constant-folded: a production build drops this branch and the fixtures module with it.
  if (__X2F_FIXTURES__) {
    const { installFixtures } = await import('./fixtures/index.js');
    installFixtures();
  }
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
