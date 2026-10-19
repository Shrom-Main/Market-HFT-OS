import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// When modern React workstation mounts, gracefully hide legacy SSR fallback containers
const legacyContainer = document.querySelector('.container');
if (legacyContainer) {
  (legacyContainer as HTMLElement).style.display = 'none';
}
const legacyBanner = document.querySelector('.banner');
if (legacyBanner) {
  (legacyBanner as HTMLElement).style.display = 'none';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
