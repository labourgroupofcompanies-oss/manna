import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

// Register PWA service worker with auto-update capability
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('A new version of Okada Book is available.');
  },
  onOfflineReady() {
    console.info('Okada Book is ready to work offline.');
  }
});

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
