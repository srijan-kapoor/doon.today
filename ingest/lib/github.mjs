// A small GitHub REST client for the review queue. In a workflow, GITHUB_TOKEN and GITHUB_REPOSITORY are
// set by Actions; issues opened with that token are authored by github-actions[bot], which notifies no one
// unless they watch the repo's issues, so lead issues are assigned to the owner (see leadIssue).
export function github({ token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetchImpl = fetch } = {}) {
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are needed');
  async function call(method, path, body) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`), { status: res.status });
    return res.status === 204 ? null : res.json();
  }
  return {
    call,
    /** Every issue with the label, open or closed, oldest pages first. Pull requests are left out. */
    async issuesWithLabel(label) {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const batch = await call('GET', `/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&page=${page}`);
        all.push(...batch.filter((i) => !i.pull_request));
        if (batch.length < 100) break;
      }
      return all;
    },
    /** Opens an issue. If GitHub refuses its assignee (422), opens it without one: a lead must never be lost
     *  over who gets the email. */
    async openIssue(issue) {
      try { return await call('POST', '/issues', issue); }
      catch (error) {
        if (error.status !== 422 || !issue.assignees) throw error;
        console.error(`Could not assign ${issue.assignees.join(', ')}; opening the issue unassigned.`);
        const { assignees, ...rest } = issue;
        return call('POST', '/issues', rest);
      }
    },
    comment: (number, body) => call('POST', `/issues/${number}/comments`, { body }),
    close: (number, reason = 'completed') => call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: reason }),
    removeLabel: (number, label) => call('DELETE', `/issues/${number}/labels/${encodeURIComponent(label)}`).catch(() => null)
  };
}
