// Hands one verified submit-form entry to the "Open lead issue" workflow (see
// netlify/functions/lead-intake.mjs). Contact details never leave Netlify: formLead drops them.
import { formLead } from './leads.mjs';

const env = (name) => globalThis.Netlify?.env?.get(name) ?? process.env[name];

export async function dispatchLead(data, { fetchImpl = fetch, token = env('DOON_GITHUB_TOKEN'), repo = env('DOON_GITHUB_REPO') || 'srijan-kapoor/doon.today' } = {}) {
  // The feedback form also says what it is in a field, in case Netlify leaves the form name out of the data.
  if ((data['form-name'] && data['form-name'] !== 'submit-event') || data.kind === 'feedback') return 'other form';
  const lead = formLead(data);
  if (!lead) return 'not a usable entry';
  if (!token) {
    console.error('DOON_GITHUB_TOKEN is not set; the entry is only in Netlify Forms.');
    return 'no token';
  }
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/lead-intake.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs: { lead: JSON.stringify(lead) } })
  });
  if (!res.ok) {
    console.error(`Could not start the lead workflow: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return 'dispatch failed';
  }
  return 'dispatched';
}
