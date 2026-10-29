import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activeFilterCount, categoryCounts, emptyFilters, filterDraft, matchesEvent, parseFilters, withFilters } from '../src/lib/filters.mjs';
import { initEventFilters } from '../src/scripts/event-filters.mjs';

const names = ['Art', 'Books', 'Comedy', 'Culture', 'Music', 'Outdoors', 'Workshop'];
const categories = names.map((name) => ({ name, value: name.toLowerCase() }));
const context = { today: '2026-10-29' };
const item = (categories, extra = {}) => ({ range: { start: '2026-10-29', end: '2026-10-29' }, categories, price: 'free', area: 'rajpur', community: true, ...extra });

test('single, repeated and comma-separated category links parse, validate and round-trip', () => {
  const options = { categories: ['music', 'comedy'], areas: ['', 'rajpur'] };
  const oldLink = parseFilters('?category=music', options);
  assert.deepEqual(oldLink.categories, ['music']);
  const parsed = parseFilters('?when=weekend&category=music,comedy&category=music&category=unknown&price=free&area=rajpur&picks=community', options);
  assert.deepEqual(parsed, { when: 'weekend', categories: ['music', 'comedy'], price: 'free', area: 'rajpur', community: true });
  const search = withFilters('?view=month&date=2026-10-31&source=friend', parsed);
  assert.deepEqual(parseFilters(search, options), { ...parsed, categories: ['comedy', 'music'] });
  const params = new URLSearchParams(search);
  assert.equal(params.get('view'), 'month');
  assert.equal(params.get('date'), '2026-10-31');
  assert.equal(params.get('source'), 'friend');
  assert.deepEqual(parseFilters('?when=invalid&category=nope&price=paid&area=bad', options), emptyFilters());
});

test('category OR combines with date, price, area and Community picks using AND', () => {
  const state = { ...emptyFilters(), when: 'today', categories: ['music', 'comedy'], price: 'free', area: 'rajpur', community: true };
  assert.equal(matchesEvent(item(['comedy']), state, context), true);
  assert.equal(matchesEvent(item(['music', 'culture']), state, context), true);
  for (const over of [{ price: 'paid' }, { area: 'malsi' }, { community: false }, { range: { start: '2026-10-30', end: '2026-10-30' } }]) {
    assert.equal(matchesEvent(item(['music'], over), state, context), false);
  }
  assert.equal(matchesEvent(item(['books']), state, context), false);
});

test('category counts ignore category choices, respect other filters, and sort by count then name', () => {
  const items = [item(['music', 'culture']), item(['music']), item(['books']), item(['comedy']), item(['art'], { price: 'paid' })];
  const state = { ...emptyFilters(), categories: ['music'], price: 'free' };
  const counts = categoryCounts(items, categories, state, context);
  assert.deepEqual(counts.slice(0, 4).map(({ name, count }) => [name, count]), [['Music', 2], ['Books', 1], ['Comedy', 1], ['Culture', 1]]);
  assert.deepEqual(counts, categoryCounts(items, categories, { ...state, categories: [] }, context));
  assert.equal(counts.find((c) => c.value === 'art').count, 0);
});

test('Month counts use its selected day, not a hidden List date shortcut', () => {
  const state = { ...emptyFilters(), when: 'today' };
  const tomorrow = item(['music'], { range: { start: '2026-10-30', end: '2026-10-30' } });
  assert.equal(matchesEvent(tomorrow, state, { ...context, view: 'month', date: '2026-10-30' }), true);
  assert.equal(matchesEvent(tomorrow, state, context), false);
});

test('sheet draft, Reset and Apply are isolated from applied filters', () => {
  const applied = { ...emptyFilters(), when: 'weekend', categories: ['music'], community: true };
  const draft = filterDraft(applied);
  draft.state.categories.push('comedy');
  draft.state.price = 'free';
  assert.deepEqual(applied.categories, ['music']);
  assert.equal(applied.price, '');
  assert.equal(activeFilterCount(draft.state), 4);
  draft.reset();
  assert.deepEqual(draft.state, { ...emptyFilters(), when: 'weekend' });
  assert.deepEqual(applied.categories, ['music']);
  const committed = draft.apply();
  committed.categories.push('books');
  assert.deepEqual(draft.state.categories, [], 'Apply also returns a copy');
});

function page(t, search = '') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00+05:30') });
  const rows = [
    item(['music', 'culture'], { price: 'paid', community: false }),
    item(['music'], { area: 'malsi', community: false }),
    item(['comedy']), item(['books']),
    item(['outdoors'], { range: { start: '2026-10-30', end: '2026-10-30' }, area: 'malsi' }),
    item(['workshop'], { range: { start: '2026-11-02', end: '2026-11-02' }, price: 'paid' }),
    item(['art'], { price: 'paid', community: false }),
  ];
  const dom = new JSDOM(`<!doctype html><html><body><div id="event-filters">
    <div>${['all', 'today', 'tomorrow', 'weekend'].map((value) => `<button data-filter="${value}">${value}</button>`).join('')}</div>
    <button id="all-categories">All</button><div id="category-shortcuts">${categories.map((c) => `<button data-quick-category="${c.value}">${c.name}<span class="filter-count"></span></button>`).join('')}</div>
    <button id="expand-categories" aria-expanded="false">All categories</button>
    <button id="open-filters">Filters<span id="active-filter-count"></span></button><button data-community-filter>Community picks<span class="filter-count"></span></button>
    <div id="desktop-filter-fields"><div id="filter-fields"><fieldset id="category-panel" hidden><div id="category-options">${categories.map((c) => `<label data-category-option="${c.value}" data-name="${c.name}"><input type="checkbox" value="${c.value}">${c.name}<span class="filter-count"></span></label>`).join('')}</div></fieldset>
    <div class="desktop-preferences"><button data-community-filter>Community picks<span class="filter-count"></span></button><button data-free-filter aria-pressed="false">Free only</button></div>
    <label><input id="community-preference" type="checkbox">Community picks<span class="filter-count"></span></label><input id="free-preference" type="checkbox">
    <select id="area-filter"><option value="">Anywhere</option><option value="rajpur" data-name="Rajpur">Rajpur</option><option value="malsi" data-name="Malsi">Malsi</option></select></div></div>
    <div id="active-filters"></div><p id="filter-status"></p>
    <dialog id="filter-sheet"><button id="close-filters">Close</button><div id="sheet-fields"></div><button id="reset-pending-filters">Reset</button><button id="apply-pending-filters">Apply</button></dialog>
    </div><section class="curated"><span id="event-count"></span><div id="empty-state"></div><div id="community-note"><span id="community-shown"></span><span id="community-total"></span><button id="community-all">Show all</button></div>
    <section class="day-group">${rows.map((row, index) => `<article class="event-row" data-id="${index}" data-categories="${row.categories.join(' ')}" data-price="${row.price}" data-area="${row.area}" data-community="${row.community ? 'yes' : ''}" data-start-date="${row.range.start}" data-end-date="${row.range.end}"><div class="event-time" data-start-time="7pm">7pm</div></article>`).join('')}</section></section>
    <button data-clear-filters>Clear all filters</button></body></html>`, { url: `https://doon.today/${search}` });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  const { document } = window;
  const sheet = document.querySelector('dialog');
  // jsdom exercises draft/control behavior; real-browser checks cover native modal focus and inertness.
  sheet.showModal = () => { sheet.open = true; };
  sheet.close = () => { sheet.open = false; };
  sheet.getBoundingClientRect = () => ({ left: 0, right: 390, top: 200, bottom: 844 });
  const api = initEventFilters(document, window);
  const $ = (selector) => document.querySelector(selector);
  const change = (selector, value = true) => { const input = $(selector); if (input.type === 'checkbox') input.checked = value; else input.value = value; input.dispatchEvent(new window.Event('change', { bubbles: true })); };
  return { api, $, window, document, sheet, change };
}

test('desktop quick row ranks dynamically; selected categories survive collapsing and leaving the top five', (t) => {
  const { $, api, document, change } = page(t);
  const quick = () => [...document.querySelectorAll('[data-quick-category]')].filter((el) => !el.hidden).map((el) => el.dataset.quickCategory);
  assert.deepEqual(quick(), ['music', 'art', 'books', 'comedy', 'culture']);
  $('#expand-categories').click();
  change('[value="outdoors"]');
  assert.deepEqual(api.state.categories, ['outdoors']);
  $('#expand-categories').click();
  assert.equal($('#category-panel').hidden, true);
  assert.ok($('#active-filters').textContent.includes('Outdoors'));
  assert.equal($('#event-count').textContent, '1');
  change('#free-preference');
  assert.deepEqual(quick().slice(0, 4), ['books', 'comedy', 'music', 'outdoors']);
  assert.deepEqual(api.state.categories, ['outdoors']);
});

test('backdrop, Close and Escape discard pending choices and never update the URL or results', (t) => {
  const { $, api, sheet, change, window } = page(t, '?category=music');
  for (const dismiss of ['backdrop', 'close', 'escape']) {
    $('#open-filters').click();
    change('[value="books"]');
    assert.equal($('#apply-pending-filters').textContent, 'Show 3 events');
    assert.equal($('#event-count').textContent, '2');
    assert.equal(window.location.search, '?category=music');
    if (dismiss === 'backdrop') {
      sheet.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
      sheet.dispatchEvent(new window.MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    } else if (dismiss === 'close') $('#close-filters').click();
    else sheet.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    assert.equal(sheet.open, false);
    assert.deepEqual(api.state.categories, ['music']);
    assert.equal($('#event-count').textContent, '2');
    assert.equal(window.location.search, '?category=music');
    assert.equal($('#filter-fields').parentElement.id, 'desktop-filter-fields');
    assert.equal(window.document.activeElement, $('#open-filters'));
  }
});

test('desktop preference pills toggle immediately and synchronize sheet checkboxes and URL', (t) => {
  const { $, api, window } = page(t, '?category=books&area=rajpur');
  const picks = $('.desktop-preferences [data-community-filter]');
  const free = $('[data-free-filter]');
  picks.click();
  free.click();
  assert.equal(picks.getAttribute('aria-pressed'), 'true');
  assert.equal(free.getAttribute('aria-pressed'), 'true');
  assert.equal($('#community-preference').checked, true);
  assert.equal($('#free-preference').checked, true);
  assert.equal(new URLSearchParams(window.location.search).get('picks'), 'community');
  assert.equal(new URLSearchParams(window.location.search).get('price'), 'free');
  assert.equal($('#event-count').textContent, '1');
  picks.click();
  free.click();
  assert.equal(picks.getAttribute('aria-pressed'), 'false');
  assert.equal(free.getAttribute('aria-pressed'), 'false');
  assert.equal($('#community-preference').checked, false);
  assert.equal($('#free-preference').checked, false);
  assert.equal(new URLSearchParams(window.location.search).has('picks'), false);
  assert.equal(new URLSearchParams(window.location.search).has('price'), false);
  assert.deepEqual(api.state.categories, ['books']);
  assert.equal(api.state.area, 'rajpur');
});

test('sheet Reset is pending, preserves the date, and Apply commits the combined choices', (t) => {
  const { $, api, sheet, change, window } = page(t, '?when=today&category=music&picks=community');
  $('#open-filters').click();
  $('#reset-pending-filters').click();
  assert.equal(api.state.community, true);
  assert.deepEqual(api.state.categories, ['music']);
  assert.equal(api.state.when, 'today');
  assert.equal($('#apply-pending-filters').textContent, 'Show 5 events');
  change('[value="books"]');
  change('#community-preference');
  change('#free-preference');
  $('#apply-pending-filters').click();
  assert.equal(sheet.open, false);
  assert.deepEqual(api.state.categories, ['books']);
  assert.equal(api.state.community, true);
  assert.equal(api.state.price, 'free');
  assert.equal($('#event-count').textContent, '1');
  assert.equal($('#active-filter-count').textContent, '3');
  assert.equal(new URLSearchParams(window.location.search).get('when'), 'today');
});

test('Tab and Shift+Tab loop between the last and first sheet controls', (t) => {
  const { $, window } = page(t);
  $('#open-filters').click();
  $('#close-filters').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(window.document.activeElement, $('#apply-pending-filters'));
  $('#apply-pending-filters').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(window.document.activeElement, $('#close-filters'));
});

test('browser Back and Forward restore categories and preferences without adding history entries', async (t) => {
  const { $, api, window } = page(t);
  $('[data-quick-category="music"]').click();
  $('[data-community-filter]').click();
  const length = window.history.length;
  const traverse = async (direction) => {
    const restored = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    window.history[direction]();
    await restored;
  };
  await traverse('back');
  assert.deepEqual(api.state.categories, ['music']);
  assert.equal(api.state.community, false);
  assert.equal($('#event-count').textContent, '2');
  await traverse('back');
  assert.deepEqual(api.state.categories, []);
  assert.equal($('#event-count').textContent, '7');
  await traverse('forward');
  assert.deepEqual(api.state.categories, ['music']);
  assert.equal(window.history.length, length);
});

test('Month facet counts track the selected day and hidden category filters can be cleared', (t) => {
  const { $, api, document } = page(t, '?when=today&category=outdoors&view=month&date=2026-10-30');
  document.documentElement.classList.add('view-month');
  api.monthDate = '2026-10-30';
  api.apply();
  assert.equal($('#event-count').textContent, '1');
  assert.equal($('[data-category-option="outdoors"] .filter-count').textContent, '1');
  assert.equal($('[data-category-option="music"] .filter-count').textContent, '0');
  $('[data-clear-filters]').click();
  assert.deepEqual(api.state.categories, []);
  assert.equal($('#event-count').textContent, '1');
});
