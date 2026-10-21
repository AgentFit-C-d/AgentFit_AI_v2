import { posix } from 'node:path';
import { checkPackage, markdownRefs, safePath, type SkillFile, type SkillPackage } from './package';
import { generalSkillQuery } from '@agentfit/contracts';
export interface SearchCandidate { id: string; name: string; repository: string; installs: number }
export interface SkillSource { search(query: string, signal: AbortSignal): Promise<SearchCandidate[]>; inspect(candidate: SearchCandidate, signal: AbortSignal): Promise<SkillPackage> }
interface SourceOptions { githubToken?: string; githubApp?: { clientId: string; clientSecret: string } | null; now?: () => number }
class SourceRequestError extends Error {
  constructor(code: string, readonly resetAt?: number, readonly retryAfterSeconds?: number) { super(code); }
}
export async function boundedText(send: typeof fetch, url: string, signal: AbortSignal, limit = 524288, headers: Record<string, string> = {}): Promise<string> {
  const response = await send(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), redirect: 'error', headers });
  if (new URL(url).origin === 'https://api.github.com' && (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))))) {
    await response.body?.cancel();
    throw new SourceRequestError('SKILL_SOURCE_RATE_LIMITED', Number(response.headers.get('x-ratelimit-reset')) * 1000, Number(response.headers.get('retry-after')));
  }
  if (new URL(url).origin === 'https://api.github.com' && response.status === 401) { await response.body?.cancel(); throw new SourceRequestError('SKILL_SOURCE_AUTH_FAILED'); }
  if (!response.ok || response.redirected || (response.headers.get('content-length') && Number(response.headers.get('content-length')) > limit)) throw new Error('SKILL_SOURCE_UNAVAILABLE');
  const reader = response.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
  if (!reader) throw new Error('SKILL_SOURCE_UNAVAILABLE');
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new Error('SKILL_SOURCE_TOO_LARGE'); parts.push(next.value); } }
  finally { await reader.cancel(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
}
export class PublicSkillSource implements SkillSource {
  private cache = new Map<string, { expires: number; candidates: SearchCandidate[] }>();
  private repositories = new Map<string, { expires: number; commit: string; paths: string[] }>();
  private blockedUntil = 0;
  private readonly secrets: readonly string[];
  private readonly authorization?: string;
  private readonly now: () => number;
  constructor(private readonly send: typeof fetch = fetch, secrets: readonly string[] = [], options: SourceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.authorization = options.githubToken ? `Bearer ${options.githubToken}` : options.githubApp ? 'Basic ' + Buffer.from(`${options.githubApp.clientId}:${options.githubApp.clientSecret}`).toString('base64') : undefined;
    this.secrets = [...secrets, ...(options.githubToken ? [options.githubToken] : []), ...(options.githubApp ? [options.githubApp.clientSecret] : []), ...(this.authorization ? [this.authorization, this.authorization.split(' ')[1]!] : [])];
  }
  async search(query: string, signal: AbortSignal): Promise<SearchCandidate[]> {
    if (!/^[a-z][a-z0-9 -]{1,99}$/.test(query) || !generalSkillQuery(query)) throw new Error('INVALID_SEARCH_QUERY');
    const cached = this.cache.get(query); if (cached && cached.expires > Date.now()) return structuredClone(cached.candidates);
    const data = JSON.parse(await boundedText(this.send, `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`, signal));
    if (!Array.isArray(data.skills)) throw new Error('INVALID_SEARCH_RESPONSE');
    const seen = new Set<string>(); const candidates: SearchCandidate[] = [];
    for (const row of data.skills.slice(0, 20)) {
      if (typeof row?.id !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-z0-9-]+$/.test(row.id) || typeof row.source !== 'string' || row.source !== row.id.split('/').slice(0, 2).join('/') || seen.has(row.id)) continue;
      seen.add(row.id); candidates.push({ id: row.id, name: row.id.split('/')[2]!, repository: row.source, installs: Number.isSafeInteger(row.installs) && row.installs >= 0 ? row.installs : 0 });
    }
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(query, { expires: Date.now() + 300000, candidates }); return structuredClone(candidates);
  }
  async inspect(candidate: SearchCandidate, signal: AbortSignal): Promise<SkillPackage> {
    if (candidate.repository !== candidate.id.split('/').slice(0, 2).join('/') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-z0-9-]+$/.test(candidate.id)) throw new Error('INVALID_SOURCE');
    const { commit, paths } = await this.repositorySnapshot(candidate.repository, signal);
    const matches = paths.filter(p => p === `${candidate.name}/SKILL.md` || p.endsWith(`/${candidate.name}/SKILL.md`));
    if (!matches.length && paths.includes('SKILL.md')) matches.push('SKILL.md');
    if (matches.length !== 1) throw new Error('SKILL_PATH_UNCONFIRMED');
    const directory = posix.dirname(matches[0]!);
    const read = async (path: string) => {
      if (!safePath(path) || !paths.includes(path)) throw new Error('MISSING_PACKAGE_REFERENCE');
      return boundedText(this.send, `https://raw.githubusercontent.com/${candidate.repository}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`, signal, 65536);
    };
    const files: SkillFile[] = [{ path: 'SKILL.md', content: await read(matches[0]!) }];
    for (let i = 0; i < files.length; i++) {
      if (files.length > 31) throw new Error('PACKAGE_TOO_LARGE');
      for (const ref of markdownRefs(files[i]!.content)) {
        const relative = posix.normalize(posix.join(posix.dirname(files[i]!.path), ref));
        if (!safePath(relative) || !/\.(?:md|txt)$/i.test(relative)) throw new Error('EXECUTABLE_OR_EXTERNAL_REFERENCE');
        if (!files.some(x => x.path === relative)) files.push({ path: relative, content: await read(posix.join(directory, relative)) });
      }
    }
    const licensePath = [posix.join(directory, 'LICENSE'), posix.join(directory, 'LICENSE.txt'), 'LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(p => paths.includes(p));
    if (!licensePath) throw new Error('LICENSE_UNCONFIRMED');
    if (files.some(x => x.path === 'LICENSE.txt')) throw new Error('LICENSE_PATH_CONFLICT');
    files.push({ path: 'LICENSE.txt', content: await read(licensePath) });
    return checkPackage(candidate.id, commit, files, new Date(), this.secrets);
  }
  private async repositorySnapshot(repository: string, signal: AbortSignal) {
    const cached = this.repositories.get(repository);
    if (cached && cached.expires > this.now()) return cached;
    if (this.blockedUntil > this.now()) throw new Error('SKILL_SOURCE_RATE_LIMITED');
    const githubRead = async (url: string, limit: number, headers: Record<string, string>) => {
      try { return await boundedText(this.send, url, signal, limit, headers); }
      catch (error) {
        if (error instanceof SourceRequestError && error.message === 'SKILL_SOURCE_RATE_LIMITED') {
          const reset = error.resetAt ?? 0;
          const retry = error.retryAfterSeconds ?? 0;
          this.blockedUntil = Math.min(this.now() + 3600000, Math.max(this.now() + 60000, Number.isFinite(reset) ? reset : 0, Number.isFinite(retry) ? this.now() + retry * 1000 : 0));
        }
        throw error;
      }
    };
    const root = `https://api.github.com/repos/${repository}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', ...(this.authorization ? { Authorization: this.authorization } : {}) };
    const commitData = JSON.parse(await githubRead(root + '/commits/HEAD', 524288, headers));
    const commit: string = commitData.sha; if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('COMMIT_UNCONFIRMED');
    const treeData = JSON.parse(await githubRead(`${root}/git/trees/${commit}?recursive=1`, 2097152, headers));
    if (treeData.truncated || !Array.isArray(treeData.tree)) throw new Error('PACKAGE_TREE_INCOMPLETE');
    const paths: string[] = treeData.tree.filter((x: { type: string; mode: string; path: string }) => x.type === 'blob' && x.mode === '100644' && typeof x.path === 'string').map((x: { path: string }) => x.path);
    if (this.repositories.size >= 32) this.repositories.delete(this.repositories.keys().next().value!);
    const snapshot = { commit, paths, expires: this.now() + 300000 };
    this.repositories.set(repository, snapshot);
    return snapshot;
  }
}
