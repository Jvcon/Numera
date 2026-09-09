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
import '@material/web/menu/menu.js';
import '@material/web/menu/menu-item.js';
import '@material/web/dialog/dialog.js';
import '@material/web/textfield/filled-text-field.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/switch/switch.js';
import '@material/web/select/filled-select.js';
import '@material/web/select/select-option.js';
import '@material/web/slider/slider.js';

import './components/settings-page';

import './app';

// Service worker registration is handled by vite-plugin-pwa via
// `injectRegister: 'auto'` (see vite.config.ts). Registering `/sw.js`
// here manually caused a double registration in production and a 404
// in dev, so it is intentionally omitted.
