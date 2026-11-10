import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// The trader app's tokens, faces and page base, and its screens' field and card styles: one look
// for both apps (the kit's own ui.css comes with each component).
import '../../web/src/theme/fonts.css';
import '../../web/src/theme/tokens.css';
import '../../web/src/theme/base.css';
import '../../web/src/screens/screens.css';
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
