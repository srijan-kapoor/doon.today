import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://doon.today',
  output: 'static',
  // Generates sitemap-index.xml, which public/robots.txt points at.
  // The thank-you pages after the submit and feedback forms are not worth indexing.
  integrations: [sitemap({ filter: (page) => !/\/(submit|feedback)\/thanks\/$/.test(page) })]
});
