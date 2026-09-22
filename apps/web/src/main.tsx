import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// Variable fonts are bundled from node_modules, so the app makes no runtime
// request to a third-party font CDN.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/main.scss';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
