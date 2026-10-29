// A small client for Bright Data's Scraper API, used asynchronously: start a job (a "snapshot"), check on
// it in a later run, download it once it is ready. Jobs take minutes and sometimes stall for hours, so no
// run ever waits on one.
const API = 'https://api.brightdata.com/datasets/v3';
const TIMEOUT_MS = 30_000;

export function brightData(token) {
  const call = async (path, init = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Bright Data ${res.status} on ${path.split('?')[0]}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };
  return {
    /** Starts collecting the given inputs; returns the snapshot id. */
    async trigger(datasetId, input) {
      const params = new URLSearchParams({ dataset_id: datasetId, include_errors: 'true' });
      return (await call(`/trigger?${params}`, { method: 'POST', body: JSON.stringify({ input }) })).snapshot_id;
    },
    /** "starting", "running", "ready", "failed" or "canceled". */
    async status(snapshotId) {
      return (await call(`/progress/${snapshotId}`)).status;
    },
    async download(snapshotId) {
      return call(`/snapshot/${snapshotId}?format=json`);
    },
    /** Recent snapshots of a dataset, newest first: [{ id, created, status }]. */
    async snapshots(datasetId) {
      return call(`/snapshots?${new URLSearchParams({ dataset_id: datasetId })}`);
    }
  };
}
