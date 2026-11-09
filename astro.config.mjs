import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pastEvents from './data/past-events.json' with { type: 'json' };

// Ended events keep their page (marked noindex), but don't belong in the sitemap.
const pastPages = new Set(pastEvents.map((e) => `https://doon.today/events/${e.slug}/`));

export default defineConfig({
  site: 'https://doon.today',
  output: 'static',
  // Generates sitemap-index.xml, which public/robots.txt points at.
  // The thank-you pages after the submit and feedback forms are not worth indexing.
  integrations: [sitemap({ filter: (page) => !/\/(submit|feedback)\/thanks\/$/.test(page) && !pastPages.has(page) })]
});
