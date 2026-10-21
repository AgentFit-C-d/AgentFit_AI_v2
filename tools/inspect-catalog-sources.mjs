const repositories = ['vercel-labs/agent-skills', 'vercel-labs/openreview', 'prisma/skills', 'better-auth/skills'];
async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'AgentFit-Catalog-Review', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`PUBLIC_SOURCE_HTTP_${response.status}`);
  return response.json();
}
const results = await Promise.allSettled(repositories.map(async repo => {
  const head = await get(`https://api.github.com/repos/${repo}/commits/main`);
  const tree = await get(`https://api.github.com/repos/${repo}/git/trees/${head.sha}?recursive=1`);
  return { repository: repo, commit: head.sha, skills: tree.tree.filter(x => x.type === 'blob' && /(^|\/)SKILL\.md$/.test(x.path)).map(x => ({ path: x.path, blob: x.sha })), licenses: tree.tree.filter(x => x.type === 'blob' && /(^|\/)(LICENSE|COPYING)(\.[^/]*)?$/i.test(x.path)).map(x => x.path) };
}));
for (const result of results) console.log(JSON.stringify(result.status === 'fulfilled' ? result.value : { error: result.reason.message }));
