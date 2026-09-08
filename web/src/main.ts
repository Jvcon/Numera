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

// Service worker registration is handled by vite-plugin-pwa via
// `injectRegister: 'auto'` (see vite.config.ts). Registering `/sw.js`
// here manually caused a double registration in production and a 404
// in dev, so it is intentionally omitted.
