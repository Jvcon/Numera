export type ThemeSetting = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'numera-theme';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeSetting): void {
  const resolved = theme === 'auto' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function loadTheme(): ThemeSetting {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeSetting | null;
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored;
  }
  return 'auto';
}

export function saveTheme(theme: ThemeSetting): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getNextTheme(current: ThemeSetting): ThemeSetting {
  const order: ThemeSetting[] = ['light', 'dark', 'auto'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length];
}

export function initTheme(): ThemeSetting {
  const theme = loadTheme();
  applyTheme(theme);

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (loadTheme() === 'auto') {
        applyTheme('auto');
      }
    });

  return theme;
}

export function cycleTheme(current: ThemeSetting): ThemeSetting {
  const next = getNextTheme(current);
  saveTheme(next);
  applyTheme(next);
  return next;
}
