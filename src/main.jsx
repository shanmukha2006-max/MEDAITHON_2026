import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { StoreProvider } from './data/store.jsx';
import { CloudProvider } from './cloud/CloudContext.jsx';
import { loadRuntimeConfig } from './backend/config.js';
import './styles.css';

// Load runtime backend settings (if any) BEFORE rendering, so every component sees the final configuration.
loadRuntimeConfig().finally(() => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <CloudProvider><StoreProvider><App /></StoreProvider></CloudProvider>
    </React.StrictMode>,
  );
});
