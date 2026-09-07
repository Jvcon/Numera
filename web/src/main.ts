import './styles/reset.css';
import './styles/tokens.css';
import './styles/motion.css';

// Registers all @material/web components. Individual imports can replace this
// once the final component set stabilizes.
import '@material/web/all.js';

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
