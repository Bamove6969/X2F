import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// The trader app's tokens, faces and page base, its screens' field and card styles, and its setup
// screens' Terms box and signature pad (for the invite's Terms step): one look for both apps (the
// kit's own ui.css comes with each component). The only imports from apps/web outside ui/kit.ts
// (test/oneDoor.test.ts).
import '../../web/src/theme/fonts.css';
import '../../web/src/theme/tokens.css';
import '../../web/src/theme/base.css';
import '../../web/src/screens/screens.css';
import '../../web/src/screens/setup/setup.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
