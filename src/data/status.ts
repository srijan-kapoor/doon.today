import rawStatus from '../../data/ingest-status.json';

export type IngestHealth = 'healthy' | 'degraded' | 'failed';

export type SourceStatus = {
  status: 'ok' | 'failed';
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  consecutiveFailures?: number;
};

export type PrimaryFreshness = {
  lastSuccessAt: string | null;
  ageHours: number | null;
  fresh: boolean;
};

export const ingestStatus = rawStatus as {
  ranAt: string;
  health?: IngestHealth;
  primarySourcesAvailable?: string[];
  primarySourcesExpected?: string[];
  primarySources?: Record<string, PrimaryFreshness>;
  sources?: Record<string, SourceStatus>;
};

const LABELS: Record<string, string> = { district: 'District' };
const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** When the event data was last refreshed, for the footer ("29 Oct, 1:59 pm"); empty if unknown. */
export const updatedLabel = () => { const t = Date.parse(ingestStatus.ranAt); return Number.isFinite(t) ? when.format(t) : ''; };

// A stale source only gets a banner for visitors once it has been days, not hours: until then the saved
// events are still close to right, and the health check already tells the site owner.
export const VISITOR_BANNER_HOURS = 72;

// One entry per primary source that has not refreshed recently, with its last successful refresh.
export function staleSources(now = Date.now()): { name: string; label: string; lastSuccess: string; ageHours: number }[] {
  return Object.entries(ingestStatus.primarySources ?? {})
    .filter(([, source]) => !source.fresh)
    .map(([name, source]) => ({
      name,
      label: LABELS[name] ?? name,
      lastSuccess: source.lastSuccessAt ? when.format(new Date(source.lastSuccessAt)) : 'not recorded yet',
      ageHours: source.lastSuccessAt ? (now - Date.parse(source.lastSuccessAt)) / 3_600_000 : Infinity
    }));
}
