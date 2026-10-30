import { istDay } from '../lib/dates.mjs';
import { festivalGroups, sessionLabel } from '../lib/festivals.mjs';
import { activeFilterCount, categoryCounts, emptyFilters, filterDraft, matchesEvent, parseFilters, withFilters } from '../lib/filters.mjs';

/** Shared applied state for List and Month. The dialog edits a separate draft. */
export function initEventFilters(document, window) {
  const root = document.querySelector('#event-filters');
  if (!root) return;
  const $ = (selector) => document.querySelector(selector);
  const today = istDay(new Date().toISOString());
  const categoryOptions = [...root.querySelectorAll('[data-category-option]')];
  const categories = categoryOptions.map((el) => ({ value: el.dataset.categoryOption, name: el.dataset.name }));
  const areaSelect = $('#area-filter');
  const options = { categories: categories.map((c) => c.value), areas: [...areaSelect.options].map((o) => o.value) };
  const state = parseFilters(window.location.search, options);
  const rows = [...document.querySelectorAll('.day-group .event-row')];
  const items = rows.map((el) => ({
    el,
    range: { start: el.dataset.startDate, end: el.dataset.endDate, ...(el.dataset.days && { days: el.dataset.days.split(' ') }) },
    categories: el.dataset.categories.split(' ').filter(Boolean),
    price: el.dataset.price,
    area: el.dataset.area,
    community: el.dataset.community === 'yes',
  }));
  const dateFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const untilFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const at = (day) => new Date(`${day}T12:00:00+05:30`);
  const groups = new Map();
  // A saved build may be days old. Regroup ongoing and recurring events for the reader's IST day.
  for (const item of items) {
    const { start, end, days } = item.range;
    const day = days ? days.find((d) => d >= today) : end < today ? undefined : start < today ? today : start;
    if (!day) { item.el.remove(); continue; }
    if (!groups.has(day)) {
      const group = document.createElement('section');
      group.className = 'day-group';
      group.dataset.date = day;
      const heading = document.createElement('h3');
      heading.textContent = dateFormat.format(at(day));
      group.append(heading);
      groups.set(day, group);
    }
    const time = item.el.querySelector('.event-time');
    time.textContent = !days && start < today ? `Until ${untilFormat.format(at(end))}` : time.dataset.startTime;
    groups.get(day).append(item.el);
  }
  document.querySelectorAll('.day-group').forEach((group) => group.remove());
  const dayGroups = [...groups.values()].sort((a, b) => a.dataset.date.localeCompare(b.dataset.date));
  dayGroups.forEach((group) => {
    const groupRows = [...group.querySelectorAll('.event-row')];
    [...groupRows.filter((r) => r.dataset.community), ...groupRows.filter((r) => !r.dataset.community)].forEach((row) => group.append(row));
    $('.curated').append(group);
  });
  const festivals = dayGroups.flatMap(groupFestivals);

  // A festival's sessions on one day fold into one row that opens to list them. The session rows stay
  // .event-row, so filters, counts and the Month view still see each session.
  function groupFestivals(group) {
    const groupRows = [...group.querySelectorAll('.event-row')];
    const found = festivalGroups(groupRows.map((row) => ({ festival: row.dataset.festival || '', venue: row.dataset.venue || '' })));
    return found.map(({ name, members }) => {
      const sessions = members.map((i) => groupRows[i]);
      const details = document.createElement('details');
      details.className = 'festival-group';
      const summary = document.createElement('summary');
      summary.className = 'festival-summary';
      summary.innerHTML = '<div class="event-time"></div><div class="event-main"><span class="event-title"></span><div class="event-meta"></div></div>';
      summary.querySelector('.event-title').textContent = name;
      sessions[0].before(details);
      details.append(summary, ...sessions);
      return { details, summary, sessions };
    });
  }

  function renderFestivals() {
    for (const { details, summary, sessions } of festivals) {
      const shown = sessions.filter((row) => !row.hidden);
      details.hidden = shown.length === 0;
      if (!shown.length) continue;
      summary.querySelector('.event-time').textContent = shown[0].querySelector('.event-time').textContent;
      summary.querySelector('.event-meta').textContent = `${sessionLabel(shown.length)} · ${shown[0].dataset.venue}`;
    }
  }

  const sheet = $('#filter-sheet');
  const fields = $('#filter-fields');
  const categoryPanel = $('#category-panel');
  const openButton = $('#open-filters');
  const expandButton = $('#expand-categories');
  const communityPreference = $('#community-preference');
  const freePreference = $('#free-preference');
  let expanded = false;
  let draft;
  let outsidePointer = false;
  const api = { state, today, monthDate: today, apply };
  const context = () => ({ today, view: document.documentElement.classList.contains('view-month') ? 'month' : 'list', date: api.monthDate });
  const mark = (button, on) => { button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); };
  const matching = (filters, ignore) => items.filter((item) => matchesEvent(item, filters, context(), ignore));
  const focusFilters = () => (window.matchMedia('(max-width: 620px)').matches ? openButton : $('#all-categories')).focus({ preventScroll: true });

  function writeUrl() {
    const query = withFilters(window.location.search, state);
    const url = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(null, '', url);
  }

  function renderFields(filters) {
    const focused = document.activeElement;
    const counts = categoryCounts(items, categories, filters, context());
    const grid = $('#category-options');
    for (const category of counts) {
      const option = categoryOptions.find((el) => el.dataset.categoryOption === category.value);
      option.querySelector('input').checked = filters.categories.includes(category.value);
      option.querySelector('.filter-count').textContent = String(category.count);
      option.classList.toggle('empty', category.count === 0);
      grid.append(option);
    }
    communityPreference.checked = filters.community;
    freePreference.checked = filters.price === 'free';
    const picks = matching(filters, 'community').filter((item) => item.community).length;
    communityPreference.parentElement.querySelector('.filter-count').textContent = String(picks);
    for (const option of areaSelect.options) {
      if (option.value) option.textContent = `${option.dataset.name} (${matching(filters, 'area').filter((item) => item.area === option.value).length})`;
    }
    areaSelect.value = filters.area;
    if (focused && grid.contains(focused)) focused.focus({ preventScroll: true });
    if (draft) {
      const n = matching(filters).length;
      $('#apply-pending-filters').textContent = `Show ${n} ${n === 1 ? 'event' : 'events'}`;
    }
    return counts;
  }

  function renderChips() {
    const container = $('#active-filters');
    const chips = [];
    const add = (label, remove) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${label} ×`;
      button.setAttribute('aria-label', `Remove ${label} filter`);
      button.addEventListener('click', () => { remove(); apply({ write: true }); focusFilters(); });
      chips.push(button);
    };
    if (state.when !== 'all' && context().view === 'list') add({ today: 'Today', tomorrow: 'Tomorrow', weekend: 'Weekend' }[state.when], () => { state.when = 'all'; });
    state.categories.forEach((value) => add(categories.find((c) => c.value === value).name, () => { state.categories = state.categories.filter((c) => c !== value); }));
    if (state.community) add('Community picks', () => { state.community = false; });
    if (state.price) add('Free only', () => { state.price = ''; });
    if (state.area) add([...areaSelect.options].find((o) => o.value === state.area).dataset.name, () => { state.area = ''; });
    if (chips.length) {
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'link-button'; clear.textContent = 'Clear all';
      clear.addEventListener('click', clearAll);
      chips.push(clear);
    }
    container.replaceChildren(...chips);
    container.hidden = chips.length === 0;
  }

  function apply({ write = false } = {}) {
    if (write) writeUrl();
    const visible = new Set(matching(state).map((item) => item.el));
    dayGroups.forEach((group) => {
      const groupRows = [...group.querySelectorAll('.event-row')];
      groupRows.forEach((row) => { row.hidden = !visible.has(row); });
      group.hidden = !groupRows.some((row) => visible.has(row));
    });
    renderFestivals();
    $('#empty-state').hidden = visible.size !== 0;
    $('#event-count').textContent = String(visible.size);
    const counts = renderFields(state);
    const shortcuts = $('#category-shortcuts');
    const focused = document.activeElement;
    counts.forEach((category, index) => {
      const button = root.querySelector(`[data-quick-category="${category.value}"]`);
      button.hidden = index >= 5;
      button.querySelector('.filter-count').textContent = String(category.count);
      mark(button, state.categories.includes(category.value));
      shortcuts.append(button);
    });
    if (focused && shortcuts.contains(focused) && !focused.hidden) focused.focus({ preventScroll: true });
    mark($('#all-categories'), state.categories.length === 0);
    root.querySelectorAll('[data-filter]').forEach((button) => mark(button, button.dataset.filter === state.when));
    root.querySelectorAll('[data-community-filter]').forEach((button) => {
      mark(button, state.community);
      button.querySelector('.filter-count').textContent = String(matching(state, 'community').filter((item) => item.community).length);
    });
    root.querySelectorAll('[data-free-filter]').forEach((button) => mark(button, state.price === 'free'));
    const n = activeFilterCount(state);
    $('#active-filter-count').hidden = n === 0;
    $('#active-filter-count').textContent = String(n);
    openButton.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
    const note = $('#community-note');
    note.hidden = !state.community;
    $('#community-shown').textContent = String(visible.size);
    $('#community-total').textContent = String(matching(state, 'community').length);
    $('#filter-status').textContent = `${visible.size} ${visible.size === 1 ? 'event' : 'events'} match your filters.`;
    renderChips();
    document.dispatchEvent(new window.Event('doon:filters'));
  }

  function clearAll() {
    Object.assign(state, emptyFilters());
    apply({ write: true });
    // Clear all is removed with the chips; focus the visible filter control instead.
    focusFilters();
  }

  function closeSheet() {
    draft = undefined;
    if (sheet.open) sheet.close();
    $('#desktop-filter-fields').append(fields);
    categoryPanel.hidden = !expanded;
    document.documentElement.classList.remove('filter-sheet-open');
    renderFields(state);
    openButton.focus({ preventScroll: true });
  }

  openButton.addEventListener('click', () => {
    draft = filterDraft(state);
    $('#sheet-fields').append(fields);
    categoryPanel.hidden = false;
    renderFields(draft.state);
    sheet.showModal();
    document.documentElement.classList.add('filter-sheet-open');
    $('#close-filters').focus({ preventScroll: true });
  });
  $('#close-filters').addEventListener('click', closeSheet);
  sheet.addEventListener('cancel', (event) => { event.preventDefault(); closeSheet(); });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...sheet.querySelectorAll('button, input, select')].filter((control) => !control.disabled && !control.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const outside = (event) => { const r = sheet.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  sheet.addEventListener('pointerdown', (event) => { outsidePointer = event.target === sheet && outside(event); });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet && outsidePointer && outside(event)) { event.preventDefault(); event.stopPropagation(); closeSheet(); }
    outsidePointer = false;
  });
  $('#reset-pending-filters').addEventListener('click', () => { draft.reset(); renderFields(draft.state); });
  $('#apply-pending-filters').addEventListener('click', () => { Object.assign(state, draft.apply()); closeSheet(); apply({ write: true }); });
  expandButton.addEventListener('click', () => {
    expanded = !expanded;
    categoryPanel.hidden = !expanded;
    expandButton.setAttribute('aria-expanded', String(expanded));
    expandButton.textContent = expanded ? 'Fewer categories ⌃' : `All ${categories.length} categories ⌄`;
  });
  $('#all-categories').addEventListener('click', () => { state.categories = []; apply({ write: true }); });
  root.querySelectorAll('[data-quick-category]').forEach((button) => button.addEventListener('click', () => {
    const value = button.dataset.quickCategory;
    state.categories = state.categories.includes(value) ? state.categories.filter((c) => c !== value) : [...state.categories, value];
    apply({ write: true });
  }));
  fields.addEventListener('change', () => {
    const target = draft ? draft.state : state;
    target.categories = categoryOptions.filter((el) => el.querySelector('input').checked).map((el) => el.dataset.categoryOption);
    target.community = communityPreference.checked;
    target.price = freePreference.checked ? 'free' : '';
    target.area = areaSelect.value;
    if (draft) renderFields(target); else apply({ write: true });
  });
  root.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.when = button.dataset.filter; apply({ write: true }); }));
  root.querySelectorAll('[data-community-filter]').forEach((button) => button.addEventListener('click', () => { state.community = !state.community; apply({ write: true }); }));
  root.querySelectorAll('[data-free-filter]').forEach((button) => button.addEventListener('click', () => { state.price = state.price === 'free' ? '' : 'free'; apply({ write: true }); }));
  $('#community-all').addEventListener('click', () => { state.community = false; apply({ write: true }); });
  document.querySelectorAll('[data-clear-filters]').forEach((button) => button.addEventListener('click', clearAll));
  window.addEventListener('popstate', () => {
    if (sheet.open) closeSheet();
    Object.assign(state, parseFilters(window.location.search, options));
    document.documentElement.classList.toggle('view-month', new URLSearchParams(window.location.search).get('view') === 'month');
    apply();
  });
  window.matchMedia('(min-width: 621px)').addEventListener('change', (event) => { if (event.matches && sheet.open) { closeSheet(); expandButton.focus({ preventScroll: true }); } });
  apply();
  return api;
}

if (typeof document !== 'undefined') globalThis.doonFilters = initEventFilters(document, window);
