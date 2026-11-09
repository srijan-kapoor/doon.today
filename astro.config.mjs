import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import events from './data/events.json' with { type: 'json' };
import pastEvents from './data/past-events.json' with { type: 'json' };

// Ended events keep their page (marked noindex), but don't belong in the sitemap.
const pastPages = new Set(pastEvents.map((e) => `https://doon.today/events/${e.slug}/`));
// An event page's lastmod is when its details last changed, so search engines know which pages to re-read.
const eventChanged = new Map(events.map((e) => [`https://doon.today/events/${e.slug}/`, e.modifiedAt || e.firstSeenAt]));

export default defineConfig({
  site: 'https://doon.today',
  output: 'static',
  // Generates sitemap-index.xml, which public/robots.txt points at.
  // The thank-you pages after the submit and feedback forms are not worth indexing.
  integrations: [sitemap({
    filter: (page) => !/\/(submit|feedback)\/thanks\/$/.test(page) && !pastPages.has(page),
    serialize: (item) => (eventChanged.get(item.url) ? { ...item, lastmod: eventChanged.get(item.url) } : item)
  })]
});
