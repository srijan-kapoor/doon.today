// The List | Month view on the home page. Builds the date strip and month grid in the browser from the event rows
// already on the page; the filters live in the page's inline script, which exposes them as globalThis.doonFilters.
import {
  DOT_LIMIT, dayLabel, dotsFor, eventsOn, mondayIndex, monthBounds, monthGrid, monthOf, parseMonthState, shiftMonth, stripDays, withMonthState,
} from '../lib/month.mjs';

const root = document.documentElement;
const container = document.querySelector('#month-view');
const filters = globalThis.doonFilters;

if (container && filters) {
  const { today } = filters;
  const $ = (selector) => container.querySelector(selector);
  const strip = $('#date-strip');
  const days = $('#month-days');
  const prev = $('#month-prev');
  const next = $('#month-next');
  const title = $('#month-title');
  const heading = $('#month-day-heading');
  const list = $('#month-day-list');
  const emptyNote = $('#month-empty');
  const switchButtons = [...document.querySelectorAll('[data-view]')];

  const items = [...document.querySelectorAll('.day-group .event-row')].map((el) => ({
    el,
    range: { start: el.dataset.startDate, end: el.dataset.endDate, ...(el.dataset.days && { days: el.dataset.days.split(' ') }) },
    categories: el.dataset.categories.split(' ').filter(Boolean),
    price: el.dataset.price,
    area: el.dataset.area,
    community: el.dataset.community === 'yes',
  }));
  const bounds = monthBounds(items, today);
  const initial = parseMonthState(location.search, today, bounds);
  let view = initial.view;
  let date = initial.date;
  let viewMonth = monthOf(date);

  const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const at = (day) => new Date(`${day}T12:00:00Z`);
  const isWeekend = (day) => mondayIndex(day) >= 5;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function dotsFrom(count, limit) {
    const { dots, overflow } = dotsFor(count, limit);
    const wrap = el('span', 'dots');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < dots; i++) wrap.append(el('i', 'dot'));
    if (overflow) wrap.append(el('b', 'more', '+'));
    return wrap;
  }

  function dayButton(day, className, limit) {
    const count = eventsOn(items, day, filters.state).length;
    const button = el('button', className);
    button.type = 'button';
    button.dataset.day = day;
    button.setAttribute('aria-label', dayLabel(day, count).text);
    button.setAttribute('aria-pressed', String(day === date));
    button.classList.toggle('selected', day === date);
    button.classList.toggle('today', day === today);
    button.classList.toggle('weekend', isWeekend(day));
    return { button, count, limit };
  }

  function renderStrip() {
    strip.replaceChildren();
    for (const day of stripDays(today)) {
      if (day.endsWith('-01')) strip.append(el('span', 'strip-month', new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(at(day))));
      const { button, count } = dayButton(day, 'day-chip', DOT_LIMIT.strip);
      button.append(el('span', 'chip-weekday', day === today ? 'Today' : weekday.format(at(day))), el('span', 'chip-date', String(Number(day.slice(8)))), dotsFrom(count, DOT_LIMIT.strip));
      strip.append(button);
    }
  }

  function renderGrid() {
    title.textContent = monthName.format(at(`${viewMonth}-01`));
    prev.disabled = viewMonth <= bounds.min;
    next.disabled = viewMonth >= bounds.max;
    days.replaceChildren();
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((name, i) => days.append(el('span', i >= 5 ? 'grid-head weekend' : 'grid-head', name)));
    for (const day of monthGrid(viewMonth).flat()) {
      if (!day) { days.append(el('span', 'grid-blank')); continue; }
      const { button, count } = dayButton(day, 'grid-day', DOT_LIMIT.grid);
      button.disabled = day < today;
      button.append(el('span', 'grid-date', String(Number(day.slice(8)))), dotsFrom(count, DOT_LIMIT.grid));
      days.append(button);
    }
  }

  function renderList() {
    const matches = eventsOn(items, date, filters.state);
    const { date: label } = dayLabel(date, matches.length);
    heading.textContent = `${label} · ${matches.length === 0 ? 'no events' : matches.length === 1 ? '1 event' : `${matches.length} events`}`;
    // Events that started on an earlier day come first, then the rest in start order (the page order);
    // within each, community events lead, as in the list.
    const lead = (list) => [...list.filter((m) => m.community), ...list.filter((m) => !m.community)];
    const ordered = [...lead(matches.filter((m) => m.range.start < date)), ...lead(matches.filter((m) => m.range.start >= date))];
    list.replaceChildren(...ordered.map((m) => {
      const row = m.el.cloneNode(true);
      row.hidden = false;
      if (!m.range.days && m.range.end > m.range.start) {
        if (m.range.start < date) row.querySelector('.event-time').textContent = 'Ongoing';
        row.querySelector('.event-tags').append(el('span', 'until', `Until ${shortDate.format(at(m.range.end))}`));
      }
      return row;
    }));
    emptyNote.hidden = matches.length !== 0;
  }

  function writeUrl() {
    const query = withMonthState(location.search, view, date);
    try { history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash); } catch (e) { /* e.g. file:// previews */ }
  }

  function render() {
    root.classList.toggle('view-month', view === 'month');
    switchButtons.forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (view !== 'month') return;
    renderStrip();
    renderGrid();
    renderList();
  }

  function pick(day) {
    date = day;
    viewMonth = monthOf(day);
    writeUrl();
    render();
    container.querySelector(`[data-day="${day}"]:not([disabled])`)?.focus({ preventScroll: true });
  }

  switchButtons.forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    writeUrl();
    render();
    filters.apply(); // recounts the filter pills for the new view
  }));
  strip.addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) pick(b.dataset.day); });
  days.addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b && !b.disabled) pick(b.dataset.day); });
  prev.addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); renderGrid(); });
  next.addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, 1); renderGrid(); });
  document.addEventListener('doon:filters', render);

  render();
  const selected = strip.querySelector('.selected');
  if (selected && view === 'month') strip.scrollLeft = Math.max(0, selected.offsetLeft - 16);
}
