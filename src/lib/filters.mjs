import { addDays, mondayIndex, runsOn } from './month-dates.mjs';

export const emptyFilters = () => ({ when: 'all', categories: [], price: '', area: '', community: false });
export const copyFilters = (state) => ({ ...state, categories: [...state.categories] });

/** Repeated category parameters keep existing single-category links valid. */
export function parseFilters(search, { categories, areas, community = true }) {
  const params = new URLSearchParams(search);
  return {
    when: ['all', 'today', 'tomorrow', 'weekend'].includes(params.get('when')) ? params.get('when') : 'all',
    categories: [...new Set(params.getAll('category').flatMap((value) => value.split(',')).filter((value) => categories.includes(value)))],
    price: params.get('price') === 'free' ? 'free' : '',
    area: areas.includes(params.get('area')) ? params.get('area') : '',
    community: community && params.get('picks') === 'community',
  };
}

/** Leave Month's view/date and unrelated parameters alone. */
export function withFilters(search, state) {
  const params = new URLSearchParams(search);
  for (const key of ['when', 'category', 'price', 'area', 'picks']) params.delete(key);
  if (state.when !== 'all') params.set('when', state.when);
  [...state.categories].sort().forEach((category) => params.append('category', category));
  if (state.price) params.set('price', state.price);
  if (state.area) params.set('area', state.area);
  if (state.community) params.set('picks', 'community');
  return params.toString();
}

function matchesCategories(categories, state) {
  const selected = state.categories ?? (state.category ? [state.category] : []);
  return selected.length === 0 || selected.some((category) => categories.includes(category));
}

export const matchesPreferences = (item, state, ignore) =>
  (ignore === 'category' || matchesCategories(item.categories, state))
  && (ignore === 'price' || !state.price || item.price === state.price)
  && (ignore === 'area' || !state.area || item.area === state.area)
  && (ignore === 'community' || !state.community || item.community);

/** Includes ongoing ranges and discrete occurrences, using calendar days in IST. */
export function matchesDate(range, when, { today, view = 'list', date = today }) {
  if (range.end < today) return false;
  if (view === 'month') return runsOn(range, date);
  if (when === 'today') return runsOn(range, today);
  if (when === 'tomorrow') return runsOn(range, addDays(today, 1));
  if (when === 'weekend') {
    const weekday = mondayIndex(today);
    const saturday = addDays(today, weekday === 6 ? -1 : 5 - weekday);
    return [saturday, addDays(saturday, 1)].some((day) => day >= today && runsOn(range, day));
  }
  return true;
}

export const matchesEvent = (item, state, context, ignore) =>
  matchesDate(item.range, state.when, context) && matchesPreferences(item, state, ignore);

/** Facet counts ignore their own selection; categories combine with OR. */
export function categoryCounts(items, categories, state, context) {
  const matching = items.filter((item) => matchesEvent(item, state, context, 'category'));
  return categories.map((category) => ({ ...category, count: matching.filter((item) => item.categories.includes(category.value)).length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));
}

export const activeFilterCount = (state) => state.categories.length + Number(Boolean(state.price)) + Number(Boolean(state.area)) + Number(state.community);

/** A sheet owns a copy until Apply; dismissing never mutates the applied state. */
export function filterDraft(applied) {
  let pending = copyFilters(applied);
  return {
    get state() { return pending; },
    reset() { pending = { ...emptyFilters(), when: applied.when }; },
    apply() { return copyFilters(pending); },
  };
}
