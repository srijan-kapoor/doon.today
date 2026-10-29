import crypto from 'node:crypto';

export const IST = '+05:30';
export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Hashtags, and the bracketed keyword lists some groups add for search ("[ Nature trail, guided walk, ... ]"),
// are for Instagram's search, not for readers.
export function stripHashtags(text='') {
  return String(text)
    .replace(/\[[^\]\n]{40,}\]/g, ' ')
    .replace(/(^|[\s\p{Extended_Pictographic}])#\p{L}[\p{L}\p{M}\p{N}_]*/gu, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function slugify(input='') {
  return input.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}
export function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|').toLowerCase()).digest('hex').slice(0, 16);
}
// Undoes one layer of HTML/XML escaping. Feeds like Reddit's Atom send a post's HTML escaped ("&lt;p&gt;"),
// so it has to be decoded before stripHtml can remove the tags. "&amp;" goes last so "&amp;lt;" stays "&lt;".
export function decodeEntities(s='') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
// Stand-ins sources use when they don't know the venue or have no real description. A merge never lets
// one of these replace a real value from another source of the same event.
const PLACEHOLDER_VENUE = /^\s*(?:venue\s*)?(?:tba|tbd|to be (?:announced|decided|confirmed))\s*[:,.\-–]?\s*(?:dehradun)?\s*$|^\s*see community post\s*$/i;
const PLACEHOLDER_DESCRIPTION = /\bcheck the organi[sz]er for\b/i;
export const isPlaceholderVenue = (name = '') => !String(name).trim() || PLACEHOLDER_VENUE.test(String(name));
export const isPlaceholderDescription = (text = '') => !String(text).trim() || PLACEHOLDER_DESCRIPTION.test(String(text));

export function stripHtml(s='') {
  const text = String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/<[^>]*$/,' ');
  // Entities are decoded after the tags are gone, so an escaped "&lt;b&gt;" in the text stays text.
  return decodeEntities(text).replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
}
/**
 * The price that schema.org offers give, in rupees, or null when they give none. Offers may be one object,
 * a list, or an AggregateOffer with its own list. The lowest real price wins; a higher one becomes the
 * range's top. An event is free only when every offer is 0, and a price in another currency is ignored
 * rather than shown as rupees.
 */
export function priceFromOffers(offers) {
  const list = flattenOffers(offers);
  // The amount after "₹" if there is one, else the first number: "1,500.00", "Rs. 500" and "Starts 2 Nov,
  // ₹499" read as 1500, 500 and 499; "TBA" reads as no price.
  let unreadable = false;
  const amount = (v) => {
    const text = String(v ?? '');
    const m = text.match(/₹\s*(\d[\d,]*(?:\.\d+)?)/)?.slice(1) || text.match(/\d[\d,]*(?:\.\d+)?/);
    if (!m && text.trim()) unreadable = true;
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const rupees = (n) => Math.max(1, Math.round(n));
  const lows = [], highs = [];
  for (const o of list) {
    if (String(o.priceCurrency || 'INR').toUpperCase() !== 'INR') continue;
    for (const v of [o.price, o.lowPrice]) { const n = amount(v); if (n !== null) lows.push(n); }
    for (const v of [o.highPrice, o.price]) { const n = amount(v); if (n !== null) highs.push(n); }
  }
  if (!lows.length && !highs.length) return null;
  const top = Math.max(...lows, ...highs);
  // Free only when every price given can be read and all are 0: "lowPrice 0, highPrice TBA" isn't free.
  if (top === 0) return unreadable ? null : { type: 'free', currency: 'INR' };
  // A free tier next to paid ones ("lowPrice 0, highPrice 500") is not a free event: show the paid price.
  const paid = lows.filter((n) => n > 0);
  const minPrice = rupees(paid.length ? Math.min(...paid) : Math.min(...highs.filter((n) => n > 0)));
  const maxPrice = rupees(top);
  return { type: 'paid', minPrice, ...(maxPrice > minPrice ? { maxPrice } : {}), currency: 'INR' };
}
// Offers nested in an AggregateOffer take its currency when they don't state their own.
function flattenOffers(offers, out = [], currency) {
  if (!offers) return out;
  if (Array.isArray(offers)) { offers.forEach((o) => flattenOffers(o, out, currency)); return out; }
  if (typeof offers === 'object') {
    const own = offers.priceCurrency || currency;
    out.push(own && !offers.priceCurrency ? { ...offers, priceCurrency: own } : offers);
    if (offers.offers) flattenOffers(offers.offers, out, own);
  }
  return out;
}

/** A price stated in an event's own words: a rupee amount, or plainly a free event. Never a guess. */
export function priceFromText(text='') {
  // "Rs" and "INR" only as words of their own, so "Doors 6:30" or "years 18" are not prices; and an amount
  // under ₹10 is more likely a time or an age than a ticket.
  const m = String(text).replace(/(\d),(?=\d)/g,'$1').match(/(?:₹|\b(?:Rs|INR)(?![a-z])\.?)\s*(\d+)/i);
  if (m && Number(m[1]) >= 10) return {type:'paid', minPrice:Number(m[1]), currency:'INR'};
  if (/\bfree\s+(?:entry|event|admission|registration|of\s+cost)\b|\bentry\s+(?:is\s+)?free\b|\bit'?s\s+a\s+free\b/i.test(text)) return {type:'free', currency:'INR'};
  return {type:'unknown', currency:'INR'};
}

export function parseMoney(text='') {
  const m = text.replace(/,/g,'').match(/(?:₹|Rs\.?|INR)\s*(\d+)/i);
  if (/\bfree\b/i.test(text)) return {type:'free', currency:'INR'};
  return m ? {type:'paid', minPrice:Number(m[1]), currency:'INR'} : {type:'unknown', currency:'INR'};
}

// Terms are matched as whole words (see wordMatcher). Substring matching made "art" match "party",
// "goa" match "goat" and "paris" match "parish".
const DEHRADUN_TERMS = [
  'dehradun','dehra dun','rajpur','raipur road','dalanwala','hathibarkala','jakhan','malsi','clement town',
  'race course','kaulagarh','prem nagar','sahastradhara','ballupur','gms road',
  'clock tower','paltan bazaar','doon library','garhi cantt','niranjanpur','vikasnagar','maldevta','bidholi'
];

// Raipur is a Dehradun locality and a city in Chhattisgarh, so only "Raipur Road" counts as Dehradun.
const OUTSIDE_TERMS = [
  'rishikesh','haridwar','roorkee','chandigarh','delhi','gurugram','noida','mumbai','bengaluru',
  'bangalore','pune','kolkata','jaipur','lucknow','hyderabad','chennai','goa','paris','france',
  'dubai','london','singapore','thailand','nepal','raipur','chhattisgarh'
];

const escapeRe = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

// Whole-word (or whole-phrase) matcher; a trailing plural "s" is allowed.
export function wordMatcher(terms) {
  return new RegExp(`(?<![a-z0-9])(?:${terms.map(escapeRe).join('|')})s?(?![a-z0-9])`, 'i');
}

const DEHRADUN_RE = wordMatcher(DEHRADUN_TERMS);
const OUTSIDE_RE = wordMatcher(OUTSIDE_TERMS);

export function isDehradunText(text='') {
  return DEHRADUN_RE.test(text);
}

export function hasOutsideGeo(text='') {
  return OUTSIDE_RE.test(text);
}

// Addresses that can't be in Dehradun, whatever venue a listing site attached: a US state with a ZIP code
// ("Frankenmuth, MI 48734"), or, in a venue address, a country other than India after a comma. "IN" is left
// out of the states because Indian
// addresses use it for India ("Uttarakhand, IN 248001"), and "UK" isn't a country here because it's also
// Uttarakhand's own abbreviation.
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_ADDRESS = new RegExp(`,\\s*(?:${US_STATES})\\s+\\d{5}(?:-\\d{4})?\\b`);
// Only in address form, after a comma, so "a speaker from the USA" doesn't count.
const FOREIGN_COUNTRY = /,\s*(?:USA|U\.S\.A\.?|United States|United Kingdom|England|Scotland|Canada|Australia|New Zealand|Germany|UAE|United Arab Emirates)\b/i;
// An Indian PIN code is the 6-digit number that ends an address, optionally followed by "India" (AllEvents
// then repeats the city). A plot number or a phone fragment earlier in the address is not a PIN.
// Dehradun district, Mussoorie included, has PIN codes starting 2480 or 2481.
const TRAILING_PIN = /(?<![\d-])([1-8]\d{5})\s*(?:,?\s*(?:India|IN)\b[^\d]*)?$/i;
/** A foreign address in free text: a US state with a ZIP code ("Frankenmuth, MI 48734"). */
export function hasForeignAddress(text='') {
  return US_ADDRESS.test(text);
}
/** A venue's own address that is abroad: a US address, or a foreign country after a comma ("Toronto, Canada"). */
export function hasForeignVenue(text='') {
  return US_ADDRESS.test(text) || FOREIGN_COUNTRY.test(text);
}
/** True when an address ends in an Indian PIN code outside Dehradun's range. */
export function hasOutsidePin(address='') {
  const pin = String(address).trim().match(TRAILING_PIN)?.[1];
  return Boolean(pin) && !/^248[01]\d{2}$/.test(pin);
}

export function isLikelyDehradunEvent({title='', description='', venueName='', address='', city=''}) {
  const semantic = `${title} ${description}`;
  const venue = `${venueName} ${address} ${city}`;

  // A US address in the listing's own words wins over a Dehradun venue the listing site attached. A
  // country name only counts in the venue's address, since a description can mention other countries
  // ("a study-abroad fair: USA, Canada"). A venue address ending in a PIN outside Dehradun counts too.
  if (hasForeignAddress(semantic) || hasForeignVenue(venue)) return false;
  if (hasOutsidePin(address)) return false;

  // A structured city that names somewhere else wins over loose text matches.
  if (city && !isDehradunText(city) && hasOutsideGeo(city)) return false;
  if (hasOutsideGeo(semantic) && !isDehradunText(semantic)) return false;
  return isDehradunText(venue) || isDehradunText(semantic);
}

export function eventPassesGeo(e) {
  return isLikelyDehradunEvent({
    title: e?.title,
    description: e?.description,
    venueName: e?.venue?.name,
    address: e?.venue?.address,
    city: e?.venue?.city
  });
}

// Category rules, in display order. Terms are whole words; "tour" only counts when it is not a
// sightseeing tour. "Live shows" is a fallback for acts that give no other signal.
const CATEGORY_RULES = [
  ['Comedy', ['comedy','stand up','standup','stand-up','open mic']],
  ['Music', ['music','musical','concert','gig','live band','band','rock night','rock band','rock show','rock music','rock concert','classic rock','live rock','dj','unplugged','sufi','qawwali','karaoke']],
  ['Books', ['book','literature','poetry','reading','author']],
  ['Outdoors', ['walking','walk','hike','hiking','trek','trekking','trail','trails','trail run','ultra','bird','birding','cycling','cyclothon','nature trail','stargazing']],
  ['Fitness', ['run','running','marathon','half marathon','5k','10k','fitness class','fitness session','fitness challenge','workout','functional training','crossfit','hiit','pickleball','calisthenics']],
  ['Games', ['board game','board games','boardgame','boardgames','game night','games night','quiz','trivia','murder mystery','mystery games','tabletop','chess','dungeons and dragons','dnd','blood on the clocktower']],
  ['Art', ['art','paint','painting','exhibition','gallery']],
  ['Workshop', ['workshop','masterclass','training','ttc','bootcamp']],
  ['Wellness', ['yoga','zumba','meditation','retreat']],
  ['Film', ['film','cinema','screening']],
  ['Culture', ['dandiya','garba','rass','navratri','heritage','culture','folk','festival']],
  ['Food', ['food','feast','brunch','tasting','cuisine','all you can eat']],
  ['Meetups', ['meetup','community','social club','hangout']]
].map(([category, terms]) => [category, wordMatcher(terms)]);

export const CATEGORY_NAMES = [...CATEGORY_RULES.map(([category]) => category), 'Live shows', 'Other'];

// Categories that were renamed. Hand-checked events keep the name they were saved with, so the merge
// and the review queue read the old name as the new one.
export const RENAMED_CATEGORIES = { Community: 'Meetups' };
export const currentCategories = (categories = []) => [...new Set(categories.map((c) => RENAMED_CATEGORIES[c] || c))];

// Categories added after events were already checked by hand. A hand-checked event keeps the categories it
// was saved with, and gains one of these when the rules find it; "Other" goes once it has a real one.
const ADDED_CATEGORIES = ['Fitness', 'Games'];
export function withAddedCategories(categories = [], text = '') {
  const added = categoryFromText(text).filter((c) => ADDED_CATEGORIES.includes(c));
  const saved = currentCategories(categories);
  // At most one is added, and none to an event that already has two real categories.
  const real = saved.filter((c) => c !== 'Other');
  const all = real.length >= 2 ? saved : [...new Set([...saved, ...added.slice(0, 1)])];
  return all.length > 1 ? all.filter((c) => c !== 'Other') : all;
}

const LIVE_RE = new RegExp(`(?<![a-z0-9])live(?![a-z0-9])|(?<!walking |heritage |city |food |bus |temple |village )(?<![a-z0-9])tours?(?![a-z0-9])`, 'i');

export function categoryFromText(text='') {
  const out = CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([category]) => category);
  if (out.length === 0 && LIVE_RE.test(text)) out.push('Live shows');
  return out.length ? out : ['Other'];
}

// Neighbourhoods and roads of Dehradun, for the "area" shown on events and used by the area filter.
// Sources rarely give an area, so it is read from the address (or venue name) when they don't.
const AREAS = [
  ['Rajpur', ['rajpur road', 'rajpur']],
  ['Dalanwala', ['dalanwala']],
  ['Hathibarkala', ['hathibarkala']],
  ['Jakhan', ['jakhan']],
  ['Malsi', ['malsi']],
  ['Clement Town', ['clement town']],
  ['Race Course', ['race course']],
  ['Kaulagarh', ['kaulagarh']],
  ['Prem Nagar', ['prem nagar']],
  ['Sahastradhara', ['sahastradhara']],
  ['Ballupur', ['ballupur']],
  ['GMS Road', ['gms road']],
  ['Clock Tower', ['clock tower']],
  ['Paltan Bazaar', ['paltan bazaar']],
  ['Garhi Cantt', ['garhi cantt']],
  ['Niranjanpur', ['niranjanpur']],
  ['Vikasnagar', ['vikasnagar']],
  ['Maldevta', ['maldevta']]
].map(([name, terms]) => [name, wordMatcher(terms)]);

/** Area names, for the suggestions on the submit form. */
export const AREA_NAMES = AREAS.map(([name]) => name);

export function areaFromText(text = '') {
  return AREAS.find(([, re]) => re.test(text))?.[0];
}

// A box around Dehradun district (Mussoorie, Chakrata, Vikasnagar, Doiwala, Rishikesh). It is a rough check:
// its corners also take in Haridwar, Saharanpur and Paonta Sahib. Coordinates outside it are another city or a
// source's mistake, and 0,0 is a placeholder, so neither is kept.
const DEHRADUN_BOUNDS = { minLat: 29.9, maxLat: 31.1, minLng: 77.5, maxLng: 78.4 };

export function isInDehradun(geo) {
  return Number.isFinite(geo?.lat) && Number.isFinite(geo?.lng)
    && geo.lat >= DEHRADUN_BOUNDS.minLat && geo.lat <= DEHRADUN_BOUNDS.maxLat
    && geo.lng >= DEHRADUN_BOUNDS.minLng && geo.lng <= DEHRADUN_BOUNDS.maxLng;
}

/** A place's schema.org `geo` as { lat, lng } (numbers, to about a metre), or undefined when missing or outside Dehradun. */
export function geoFrom(place) {
  const geo = place?.geo;
  if (!geo || typeof geo !== 'object') return undefined;
  const number = (v) => (v === '' || v == null ? NaN : Number(v));
  const round = (n) => Math.round(n * 1e5) / 1e5;
  const point = { lat: round(number(geo.latitude ?? geo.lat)), lng: round(number(geo.longitude ?? geo.lng ?? geo.lon)) };
  return isInDehradun(point) ? point : undefined;
}
