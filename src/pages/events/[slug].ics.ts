import type { APIRoute } from 'astro';
import { events, pastEvents } from '../../data/events';
import { buildEventCalendar } from '../../lib/ics.mjs';

// Ended events keep their page for a while (see ingest/lib/past.mjs), so they keep their calendar file too:
// Search Console had crawled these links while the event was listed, and a bare 404 after it ended showed up
// as "Not found".
export function getStaticPaths() {
  return [...events.filter((e) => e.curation.status === 'published'), ...pastEvents]
    .map((event) => ({ params: { slug: event.slug }, props: { event } }));
}

export const GET: APIRoute = ({ props }) => {
  const event = props.event;
  return new Response(buildEventCalendar(event), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${event.slug}.ics"`
    }
  });
};
