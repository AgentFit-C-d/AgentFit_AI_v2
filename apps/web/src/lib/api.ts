import type { AnalysisInput, AttemptDto, ProfilePatch, ProjectDto, ProviderId, SessionUser, UploadGrant, DeveloperProfile, EnvironmentProfile, StoredProfile, ProfilePut, RecommendationDto } from '@agentfit/contracts';
import type { PreviewInput, Preview, ApprovalInput, ConfigurationApproval, ExportInput, ConfigurationHistoryEntry, UserConfigurationReport } from '@agentfit/contracts';
import { notifySessionEnded, sessionRequestSignal } from './session-lifetime';
import type { SkillDiscoveryDto } from '@agentfit/contracts';
export function createApiClient(send: typeof fetch = fetch) {
  async function request<T>(path: string, options: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('INVALID_API_PATH');
    const lifetime = sessionRequestSignal(options.signal, path !== '/api/me' && path !== '/api/runtime');
    try {
    let response: Response;
    try { response = await send(path, { ...options, signal: lifetime.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }); } catch { throw new Error(lifetime.signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR'); }
    return await consume(response);
    } finally { lifetime.dispose(); }
  }
  async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
    return request(path, options, async response => {
    if (response.status === 204) return undefined as T;
    let body: unknown; try { body = await response.json(); } catch { throw new Error('INVALID_API_RESPONSE'); }
    if (!response.ok) {
      const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error ? body.error.code : null;
      if (response.status === 401 && path !== '/api/me') notifySessionEnded();
      throw new Error(typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'REQUEST_FAILED');
    }
    return body as T;
    });
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
  const analyze = (id: string, input: AnalysisInput, provider: ProviderId, signal?: AbortSignal) => call<AttemptDto>(projectPath(id) + '/analysis', { ...json('POST', { input, provider }), signal });
  return {
    me: () => call<SessionUser>('/api/me'),
    runtime: () => call<{ githubConfigured: boolean; analysisConfigured: boolean; uploadMode: string; skillDiscoveryConfigured?: boolean }>('/api/runtime'),
    listProjects: () => call<ProjectDto[]>('/api/projects'),
    createProject: (name: string) => call<ProjectDto>('/api/projects', json('POST', { name })),
    project: (id: string) => call<ProjectDto>(projectPath(id)),
    saveProfile: (id: string, patch: ProfilePatch) => call<ProjectDto>(projectPath(id) + '/profile', json('PATCH', patch)),
    deleteProject: (id: string) => call<void>(projectPath(id), json('DELETE', { confirmation: true })),
    analyze,
    attempt: (id: string, attemptId: string) => call<AttemptDto>(projectPath(id) + `/analysis/${encodeURIComponent(attemptId)}`),
    cancel: (id: string, attemptId: string) => call<AttemptDto>(projectPath(id) + `/analysis/${encodeURIComponent(attemptId)}/cancel`, json('POST', {})),
    developer: (id: string) => call<{ profile: StoredProfile<DeveloperProfile> | null }>(projectPath(id) + '/developer-profile'),
    environment: (id: string) => call<{ profile: StoredProfile<EnvironmentProfile> | null }>(projectPath(id) + '/environment-profile'),
    saveDeveloper: async (id: string, patch: ProfilePut<DeveloperProfile>) => (await call<{ profile: StoredProfile<DeveloperProfile> }>(projectPath(id) + '/developer-profile', json('PUT', patch))).profile,
    saveEnvironment: async (id: string, patch: ProfilePut<EnvironmentProfile>) => (await call<{ profile: StoredProfile<EnvironmentProfile> }>(projectPath(id) + '/environment-profile', json('PUT', patch))).profile,
    catalog: () => call<{ revision: string; items: { id: string; name: string; version: string; risk: string; skillsUrl: string; license: string; verificationStatus: string }[] }>('/api/tool-catalog'),
    recommend: async (id: string, expectedVersions: { project: number; developer: number; environment: number }) => (await call<{ recommendation: RecommendationDto }>(projectPath(id) + '/recommendations', json('POST', { expectedVersions }))).recommendation,
    recommendation: (id: string) => call<{ recommendation: RecommendationDto | null }>(projectPath(id) + '/recommendations/latest'),
    startDiscovery: async (id: string, expectedVersions: { project: number; developer: number; environment: number }, signal?: AbortSignal) => (await call<{ discovery: SkillDiscoveryDto }>(projectPath(id) + '/skill-discoveries', { ...json('POST', { expectedVersions }), signal })).discovery,
    discovery: async (id: string, discoveryId: string, signal?: AbortSignal) => (await call<{ discovery: SkillDiscoveryDto }>(projectPath(id) + '/skill-discoveries/' + encodeURIComponent(discoveryId), { signal })).discovery,
    latestDiscovery: (id: string) => call<{ discovery: SkillDiscoveryDto | null }>(projectPath(id) + '/skill-discoveries/latest'),
    preview: async (id: string, input: PreviewInput, signal?: AbortSignal) => (await call<{ preview: Preview }>(projectPath(id) + '/config-previews', { ...json('POST', input), signal })).preview,
    approve: async (id: string, input: ApprovalInput, signal?: AbortSignal) => (await call<{ approval: ConfigurationApproval }>(projectPath(id) + '/config-approvals', { ...json('POST', input), signal })).approval,
    history: (id: string, cursor?: string) => call<{ entries: ConfigurationHistoryEntry[]; nextCursor: string | null }>(projectPath(id) + '/configuration-history' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')),
    report: (id: string, configurationId: string, input: Pick<UserConfigurationReport, 'reportedState' | 'reasonCode'>) => call<{ report: UserConfigurationReport }>(projectPath(id) + '/configuration-history/' + encodeURIComponent(configurationId) + '/reports', json('POST', input)),
    async export(id: string, input: ExportInput, signal?: AbortSignal): Promise<{ blob: Blob; configurationId: string }> {
      return request(projectPath(id) + '/config-exports', { ...json('POST', input), signal }, async response => {
      if (!response.ok) { let code = 'REQUEST_FAILED'; try { const body = await response.json(); if (typeof body?.error?.code === 'string' && /^[A-Z_]{1,64}$/.test(body.error.code)) code = body.error.code; } catch {} if (response.status === 401) notifySessionEnded(); throw new Error(code); }
      if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/zip') throw new Error('INVALID_API_RESPONSE');
      const configurationId = response.headers.get('X-Configuration-Id'); if (!configurationId || !/^[A-Za-z0-9_-]{1,128}$/.test(configurationId)) throw new Error('INVALID_API_RESPONSE');
      const blob = await response.blob(); const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (magic[0] !== 80 || magic[1] !== 75 || magic[2] !== 3 || magic[3] !== 4) throw new Error('INVALID_API_RESPONSE');
      return { blob, configurationId };
      });
    },
    async analyzeFile(id: string, file: File, provider: ProviderId): Promise<AttemptDto> {
      const lifetime = sessionRequestSignal();
      try {
      const kind = /\.pdf$/i.test(file.name) ? 'pdf' : 'markdown';
      const contentType = kind === 'pdf' ? 'application/pdf' : 'text/markdown';
      const grant = await call<UploadGrant>(projectPath(id) + '/uploads', { ...json('POST', { kind, size: file.size, contentType }), signal: lifetime.signal });
      if (!grant.uploadUrl.startsWith(projectPath(id) + '/uploads/') || !/^inputs\/[A-Za-z0-9_-]+$/.test(grant.objectKey)) throw new Error('INVALID_API_RESPONSE');
      if (grant.storage === 'local') await call<void>(grant.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file, signal: lifetime.signal });
      else {
        const { upload } = await import('@vercel/blob/client');
        await upload(grant.objectKey, file, { access: 'private', handleUploadUrl: grant.uploadUrl, contentType, multipart: false, abortSignal: lifetime.signal });
      }
      for (let wait = 0; ; wait++) {
        if (lifetime.signal.aborted) throw new Error('REQUEST_ABORTED');
        try { return await analyze(id, { kind: 'upload', uploadId: grant.uploadId }, provider, lifetime.signal); }
        catch (error) { if (!(error instanceof Error) || error.message !== 'UPLOAD_NOT_READY' || wait >= 10) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
      }
      } finally { lifetime.dispose(); }
    },
  };
}
export const apiClient = createApiClient();
