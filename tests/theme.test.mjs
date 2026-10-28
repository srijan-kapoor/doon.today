import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { THEME_KEY, applyTheme, currentTheme, nextTheme, saveTheme, savedTheme } from '../src/lib/theme.mjs';

const file = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};
const brokenStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };

test('the saved theme is dark only when dark was chosen, and storage failures fall back to light', () => {
  assert.equal(savedTheme(memoryStorage({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(savedTheme(memoryStorage()), 'light');
  assert.equal(savedTheme(memoryStorage({ [THEME_KEY]: 'sepia' })), 'light');
  assert.equal(savedTheme(brokenStorage), 'light');
  assert.equal(savedTheme(undefined), 'light');

  const storage = memoryStorage();
  saveTheme(storage, 'dark');
  assert.deepEqual(storage.data, { [THEME_KEY]: 'dark' });
  saveTheme(storage, 'light');
  assert.deepEqual(storage.data, {}, 'light is the default, so it clears the entry');
  assert.doesNotThrow(() => saveTheme(brokenStorage, 'dark'));
  assert.doesNotThrow(() => saveTheme(undefined, 'dark'));

  const root = { dataset: {} };
  applyTheme(root, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(currentTheme(root), 'dark');
  applyTheme(root, 'light');
  assert.equal('theme' in root.dataset, false);
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
});

test('the head script applies a saved dark theme before the page draws, and never throws', async () => {
  const layout = await file('../src/layouts/BaseLayout.astro');
  const boot = layout.match(/<script is:inline data-theme-boot>([\s\S]*?)<\/script>/);
  assert.ok(boot, 'the boot script is in BaseLayout');
  assert.ok(boot[1].includes(`'${THEME_KEY}'`), 'it reads the same key as src/lib/theme.mjs');
  assert.ok(layout.indexOf('data-theme-boot') < layout.indexOf('</head>'), 'it runs in <head>');
  const run = (localStorage) => {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(boot[1], { document, localStorage });
    return document.documentElement.dataset.theme;
  };
  assert.equal(run(memoryStorage({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(run(memoryStorage()), undefined);
  assert.equal(run(brokenStorage), undefined, 'blocked storage leaves the light theme');
});

test('the toggle switches the theme, the buttons, the browser colour and storage', async () => {
  const handlers = [];
  const button = () => ({ attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { if (type === 'click') handlers.push(fn); } });
  const buttons = [button(), button()];
  const root = { dataset: {} };
  const meta = { content: '#f6f1e8' };
  const storage = memoryStorage();
  Object.assign(globalThis, {
    document: { documentElement: root, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null), querySelectorAll: (s) => (s === '[data-theme-toggle]' ? buttons : []) },
    getComputedStyle: () => ({ getPropertyValue: () => (root.dataset.theme === 'dark' ? ' #111a16' : ' #f6f1e8') }),
    localStorage: storage
  });
  await import('../src/scripts/theme-toggle.mjs');
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false'], 'both buttons start in step with the page');
  handlers[0]();
  assert.equal(root.dataset.theme, 'dark');
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['true', 'true'], 'the other button follows');
  assert.equal(buttons[1].title, 'Switch to light theme');
  assert.equal(meta.content, '#111a16');
  assert.deepEqual(storage.data, { [THEME_KEY]: 'dark' });
  handlers[1]();
  assert.equal('theme' in root.dataset, false);
  assert.equal(meta.content, '#f6f1e8');
  assert.deepEqual(storage.data, {});
  delete globalThis.document; delete globalThis.getComputedStyle; delete globalThis.localStorage;
});

// The two token blocks at the top of global.css: light (:root) and dark.
async function tokenBlocks() {
  const css = await file('../src/styles/global.css');
  const light = css.match(/^:root \{([\s\S]*?)\n\}/m);
  const dark = css.match(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m);
  const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return { css, light: tokens(light[1]), dark: tokens(dark[1]), rest: css.replace(light[0], '').replace(dark[0], '') };
}

test('every colour on the site is a token, and the dark theme sets every one of them', async () => {
  const { light, dark, rest } = await tokenBlocks();
  const stray = rest.replace(/white-space/g, '').match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b/gi);
  assert.equal(stray, null, `colours outside the token blocks: ${stray}`);
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'dark overrides every light token');
});

test('text passes WCAG AA (4.5:1) on its background in both themes', async () => {
  const { light, dark } = await tokenBlocks();
  const luminance = (hex) => {
    const [r, g, b] = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [['--ink', '--paper'], ['--muted', '--paper'], ['--green', '--paper'], ['--on-green', '--green'], ['--tag-ink', '--green-soft'], ['--community-ink', '--community'], ['--warn-ink', '--warn-bg']];
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    for (const [text, background] of pairs) {
      assert.ok(ratio(theme[text], theme[background]) >= 4.5, `${name}: ${text} on ${background} is ${ratio(theme[text], theme[background]).toFixed(2)}:1`);
    }
  }
});
