// Light (the default) or dark, chosen with the header toggle and kept in this browser. The saved choice is
// applied before the page draws by a small inline script in BaseLayout's <head>, which reads the same key.
export const THEME_KEY = 'doon.theme';

/** The saved theme: dark only when "dark" is stored; light otherwise, or when storage can't be read. */
export function savedTheme(storage) {
  try { return storage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

/** Remembers dark; light is the default, so choosing it clears the entry. Storage may be unavailable. */
export function saveTheme(storage, theme) {
  try {
    if (theme === 'dark') storage?.setItem(THEME_KEY, 'dark');
    else storage?.removeItem(THEME_KEY);
  } catch {}
}

/** Shows the theme on the page: `data-theme="dark"` on <html>, or no attribute for light. */
export function applyTheme(root, theme) {
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
}

export const currentTheme = (root) => (root.dataset.theme === 'dark' ? 'dark' : 'light');
export const nextTheme = (theme) => (theme === 'dark' ? 'light' : 'dark');
