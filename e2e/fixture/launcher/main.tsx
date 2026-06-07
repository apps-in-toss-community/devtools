// AITC DevTools Launcher — entry point.
//
// Side-effect: registers the <pwa-install> custom element. The library
// handles the cross-browser install dialog itself (Android Chrome
// `beforeinstallprompt`, iOS share-sheet illustration, Firefox/Safari manual
// fallback).
import '@khmyznikov/pwa-install';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Launcher } from './Launcher.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in launcher/index.html');

createRoot(root).render(
  <StrictMode>
    <Launcher />
  </StrictMode>,
);
