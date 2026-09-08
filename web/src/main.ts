import './styles/reset.css';
import './styles/tokens.css';
import './styles/motion.css';

// Registers only the @material/web components used by the app. Importing
// `@material/web/all.js` pulled in every component (~700 kB minified);
// individual entry points tree-shake the rest.
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';

import './app';

async function registerServiceWorker(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        type: 'module',
      });
      console.log('[numera] service worker registered:', registration.scope);
    } catch (error) {
      console.warn('[numera] service worker registration failed:', error);
    }
  }
}

registerServiceWorker();
