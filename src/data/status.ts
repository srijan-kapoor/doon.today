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

// One entry per primary source that has not refreshed recently, with its last successful refresh.
export function staleSources(): { name: string; label: string; lastSuccess: string }[] {
  return Object.entries(ingestStatus.primarySources ?? {})
    .filter(([, source]) => !source.fresh)
    .map(([name, source]) => ({
      name,
      label: LABELS[name] ?? name,
      lastSuccess: source.lastSuccessAt ? when.format(new Date(source.lastSuccessAt)) : 'not recorded yet'
    }));
}
