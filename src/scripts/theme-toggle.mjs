// The light/dark toggle: the round button in the header and the "Dark theme" row in the phone menu. The head
// script has already applied the saved theme; this keeps the buttons, the browser's theme colour and storage in step.
import { applyTheme, currentTheme, nextTheme, saveTheme } from '../lib/theme.mjs';

const root = document.documentElement;
const meta = document.querySelector('meta[name="theme-color"]');
const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
let storage;
try { storage = globalThis.localStorage; } catch {}

function sync() {
  const dark = currentTheme(root) === 'dark';
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }
  // The mobile browser bar follows the page background.
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--paper').trim();
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    const theme = nextTheme(currentTheme(root));
    applyTheme(root, theme);
    saveTheme(storage, theme);
    sync();
  });
}
sync();
