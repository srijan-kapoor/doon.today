// Source selection, per-source freshness tracking and health calculation for the ingest run.
//
// District sits behind bot protection that rejects GitHub-hosted runner IPs, so it is fetched from a
// separate run on a normal connection. Each run therefore only touches the sources it actually ran
// and carries every other source's status forward from the previous run.

export const PRIMARY_SOURCES = ['district'];
// Three refreshes a day; allow one missed run plus slack before a primary source counts as stale.
export const DEFAULT_MAX_AGE_HOURS = 36;

export const adapterName = (fn) => fn.name.replace(/^fetch/, '').toLowerCase();

const list = (value = '') => value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function selectAdapters(adapters, { only = '', skip = '' } = {}) {
  const onlyList = list(only);
  const skipList = list(skip);
  const known = new Set(adapters.map(adapterName));
  for (const name of [...onlyList, ...skipList]) {
    if (!known.has(name)) {
      throw new Error(`Unknown ingest source "${name}". Known sources: ${[...known].join(', ')}`);
    }
  }
  return adapters.filter((fn) => {
    const name = adapterName(fn);
    if (skipList.includes(name)) return false;
    return onlyList.length === 0 || onlyList.includes(name);
  });
}

/** The previous run's per-source status, keeping only sources that still have an adapter. */
export const knownSources = (sources = {}, adapters) => {
  const known = new Set(adapters.map(adapterName));
  return Object.fromEntries(Object.entries(sources).filter(([name]) => known.has(name)));
};

// Merge one adapter outcome into the previous entry for that source.
export function recordAttempt(previous = {}, outcome, nowIso) {
  if (outcome.status === 'ok') {
    return { ...outcome, lastAttemptAt: nowIso, lastSuccessAt: nowIso, consecutiveFailures: 0 };
  }
  return {
    ...outcome,
    lastAttemptAt: nowIso,
    lastSuccessAt: previous.lastSuccessAt,
    consecutiveFailures: (previous.consecutiveFailures || 0) + 1
  };
}

export function ageHours(iso, now) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (now - t) / 3_600_000 : null;
}

export function primaryFreshness(sources, { now, maxAgeHours = DEFAULT_MAX_AGE_HOURS, primary = PRIMARY_SOURCES }) {
  const out = {};
  for (const name of primary) {
    const lastSuccessAt = sources[name]?.lastSuccessAt ?? null;
    const age = ageHours(lastSuccessAt, now);
    out[name] = {
      lastSuccessAt,
      ageHours: age === null ? null : Math.round(age * 10) / 10,
      fresh: age !== null && age <= maxAgeHours
    };
  }
  return out;
}

export function computeHealth(sources, { now, published, maxAgeHours = DEFAULT_MAX_AGE_HOURS, primary = PRIMARY_SOURCES }) {
  const primarySources = primaryFreshness(sources, { now, maxAgeHours, primary });
  const fresh = primary.filter((name) => primarySources[name].fresh);
  const successful = Object.values(sources).filter((s) => s.status === 'ok').length;
  const health =
    published === 0 ? 'failed' :
    fresh.length === primary.length ? 'healthy' :
    successful > 0 ? 'degraded' : 'failed';
  return {
    health,
    primarySourcesAvailable: fresh,
    primarySourcesExpected: primary,
    primarySources
  };
}
