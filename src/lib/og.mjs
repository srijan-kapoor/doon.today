// The link-preview card for an event page (og:image): what WhatsApp, search and social sites show when the
// page is shared. Drawn at build time with satori (layout) and resvg (PNG), using bundled open fonts so the
// result doesn't depend on the fonts installed on the build machine. Same look as public/og-default.png.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { nextOccurrence, DATE_ONLY, toInstant } from './dates.mjs';
import { priceLabel } from './sources.mjs';

const require = createRequire(import.meta.url);
const font = (pkg, file) => fs.readFileSync(require.resolve(`${pkg}/files/${file}`));
const FONTS = [
  { name: 'Serif', data: font('@fontsource/source-serif-4', 'source-serif-4-latin-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'Sans', data: font('@fontsource/inter', 'inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'Sans', data: font('@fontsource/inter', 'inter-latin-600-normal.woff'), weight: 600, style: 'normal' }
];
// The site's light-theme colours (src/styles/global.css).
const PAPER = '#f6f1e8';
const GREEN = '#0b5b3f';
const INK = '#13201a';
const MUTED = '#5f6b64';
export const CARD = { width: 1200, height: 630 };

const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** "Sat, 15 Nov · 7:30 pm", or the day alone when the time isn't known. */
export function cardWhen(e) {
  const start = nextOccurrence(e);
  const text = DATE_ONLY.test(start) ? day.format(new Date(`${start}T12:00:00+05:30`)) : `${day.format(toInstant(start))} · ${time.format(toInstant(start))}`;
  return text;
}

/** Venue, area and city. Listing sites often end a venue's name with the city ("IRDT Auditorium: Dehradun"); it's said once. */
export function cardWhere(e) {
  const venue = String(e.venue?.name || '').replace(/\s*[:,-]\s*dehradun$/i, '');
  return clip([venue, e.venue?.area, 'Dehradun'].filter(Boolean).join(' · '), 70);
}

/** A smaller title for a longer name, so it fits in three lines. */
const titleSize = (title) => (title.length <= 28 ? 84 : title.length <= 48 ? 68 : title.length <= 72 ? 56 : 46);
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

const el = (type, style, children) => ({ type, props: { style, children } });

/** The card as a PNG buffer. */
export async function eventCard(e) {
  const title = clip(e.title, 96);
  const where = cardWhere(e);
  // The bundled font subsets have no rupee sign, so the card writes Rs.
  const price = priceLabel(e.pricing)?.replace(/₹\s*/g, 'Rs ');
  const tree = el('div', { width: CARD.width, height: CARD.height, display: 'flex', flexDirection: 'column', background: PAPER, borderTop: `14px solid ${GREEN}`, padding: '64px 88px', fontFamily: 'Sans' }, [
    el('div', { display: 'flex', fontFamily: 'Serif', fontSize: 44, color: GREEN, letterSpacing: -1.5 }, 'doon.today'),
    el('div', { display: 'flex', marginTop: 44, fontSize: 26, fontWeight: 600, color: GREEN, letterSpacing: 3 }, cardWhen(e).toUpperCase()),
    el('div', { display: 'block', width: CARD.width - 176, marginTop: 18, fontFamily: 'Serif', fontSize: titleSize(title), lineHeight: 1.05, color: INK, letterSpacing: -2 }, title),
    el('div', { display: 'flex', marginTop: 28, fontSize: 28, color: MUTED }, price ? `${where} · ${price}` : where)
  ]);
  const svg = await satori(tree, { ...CARD, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: CARD.width } }).render().asPng();
}
