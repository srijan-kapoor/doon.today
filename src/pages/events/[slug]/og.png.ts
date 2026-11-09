import type { APIRoute } from 'astro';
import { events } from '../../../data/events';
import { eventCard } from '../../../lib/og.mjs';

// One link-preview card per listed event, drawn at build time (src/lib/og.mjs). Ended events keep the default card.
export function getStaticPaths() {
  return events
    .filter((e) => e.curation.status === 'published')
    .map((event) => ({ params: { slug: event.slug }, props: { event } }));
}

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await eventCard(props.event)), { headers: { 'Content-Type': 'image/png' } });
