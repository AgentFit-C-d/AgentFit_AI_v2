'use client';
import type { ReactNode } from 'react';
import type { ProjectDto, RecommendationDto, SkillDiscoveryDto } from '@agentfit/contracts';
import { apiClient } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import type { DeveloperProfile, EnvironmentProfile, StoredProfile } from '@agentfit/contracts';
import { DeveloperEditor } from './DeveloperEditor';
import { EnvironmentEditor } from './EnvironmentEditor';
import { errorMessage } from '../lib/errors';
import { RecommendationCards } from './RecommendationCards';
export interface RecommendationPanelProps { project: ProjectDto; client?: typeof apiClient; children?(selection: { recommendation: RecommendationDto; selectedIds: string[] }): ReactNode }
const outcomes = { RECOMMENDED: '프로젝트에 맞는 구성을 추천합니다', NO_ADDITIONS_NEEDED: '추가 도구가 필요하지 않습니다', NEEDS_INFORMATION: '정보 확인이 필요합니다', NO_COMPATIBLE_TOOLS: '호환되는 검증 후보가 없습니다' };
function discoveryFailure(code: string | null): string {
  if (code === 'SKILL_SOURCE_RATE_LIMITED') return 'GitHub 원본 조회 한도에 도달했습니다. 한도가 초기화된 뒤 다시 추천을 받아 주세요. 기존 추천과 확인 정보는 유지됩니다.';
  if (code === 'SKILL_SOURCE_AUTH_FAILED') return 'GitHub 원본 조회 인증에 실패했습니다. 서버의 조회 인증 설정을 확인해 주세요. 기존 추천과 확인 정보는 유지됩니다.';
  const reasons: Record<string, string> = { SKILL_AI_TIMEOUT: 'AI 모델이 제한 시간 안에 응답하지 않았습니다.', SKILL_DISCOVERY_TIMEOUT: '새 후보 탐색의 전체 제한 시간을 초과했습니다.', SKILL_AI_INVALID_RESPONSE: 'AI 응답이 필요한 형식이나 근거 조건을 충족하지 못했습니다.', SKILL_AI_AUTH_FAILED: 'AI 공급자 인증에 실패했습니다. 서버의 API 키 설정을 확인해야 합니다.', SKILL_AI_RATE_LIMITED: 'AI 공급자의 사용량 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.', SKILL_AI_UNAVAILABLE: 'AI 서버 또는 공급자에서 요청을 처리하지 못했습니다.', SKILL_PACKAGE_CHECK_FAILED: '검색한 새 후보가 모두 패키지 검사 조건을 충족하지 못했습니다.', SKILL_BUDGET_EXCEEDED: '설정한 Upstage 사용 예산 상한에 도달했습니다.' };
  return `새 후보 탐색에 실패했습니다. ${code && reasons[code] ? `${reasons[code]} ` : ''}기존 추천과 확인 정보는 유지됩니다. 다시 추천을 받아 시도할 수 있습니다.`;
}
const packageIssues: Record<string, string> = { LICENSE_UNCONFIRMED: '라이선스 미확인', MISSING_PACKAGE_REFERENCE: '필수 참조 파일 누락', EXECUTABLE_DEPENDENCY: '실행 파일·별도 도구 의존', EXECUTABLE_OR_EXTERNAL_REFERENCE: '실행 파일 또는 범위 밖 참조', SECRET_DETECTED: '비밀값으로 보이는 내용', UNSAFE_PACKAGE_INSTRUCTION: '보안 경계를 변경하는 지시', DUPLICATE_PACKAGE: '중복 패키지', INVALID_SKILL_FORMAT: '지원하지 않는 Skill 형식', SKILL_PATH_UNCONFIRMED: 'Skill 원본 경로 미확인', PACKAGE_SOURCE_UNAVAILABLE: '공급원 조회 실패', SKILL_SOURCE_RATE_LIMITED: 'GitHub 조회 한도 초과', SKILL_SOURCE_AUTH_FAILED: 'GitHub 조회 인증 실패', SKILL_SOURCE_TOO_LARGE: '공급원 응답 크기 초과' };
export function RecommendationPanel({ project, client = apiClient, children }: RecommendationPanelProps) {
  const [developer, setDeveloper] = useState<StoredProfile<DeveloperProfile> | null>(null); const [environment, setEnvironment] = useState<StoredProfile<EnvironmentProfile> | null>(null);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof client.catalog>> | null>(null); const [recommendation, setRecommendation] = useState<RecommendationDto | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [dirtyDeveloper, setDirtyDeveloper] = useState(false); const [dirtyEnvironment, setDirtyEnvironment] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(false); const [discovery, setDiscovery] = useState<SkillDiscoveryDto | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  async function awaitDiscovery(job: SkillDiscoveryDto, versions: { project: number; developer: number; environment: number }, request: number, signal: AbortSignal) {
    while (['QUEUED', 'SEARCHING', 'CHECKING'].includes(job.status)) {
      if (request !== requestSequence.current || signal.aborted) return;
      setDiscovery(job);
      if (Date.now() > Date.parse(job.deadline) + 5000) throw new Error('SKILL_DISCOVERY_TIMEOUT');
      await new Promise<void>(resolve => { const timer = setTimeout(finish, 1000); function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); } signal.addEventListener('abort', finish, { once: true }); });
      if (signal.aborted) return;
      job = await client.discovery(project.id, job.id, signal);
    }
    if (request !== requestSequence.current || signal.aborted) return;
    setDiscovery(job);
    if (job.status === 'SUCCEEDED') { const result = await client.recommend(project.id, versions); if (request === requestSequence.current) { setRecommendation(result); setDiscoveryMessage('기능·업무별 후보 탐색과 패키지 검사를 완료했습니다.'); } }
    else if (job.status === 'STALE') setDiscoveryMessage('탐색 중 프로젝트·역할·환경이 변경되었습니다. 저장한 조건으로 다시 추천을 받아 주세요.');
    else setDiscoveryMessage(discoveryFailure(job.errorCode));
  }
  useEffect(() => {
    let alive = true; setLoading(true); setBusy(false);
    void Promise.all([client.developer(project.id), client.environment(project.id), client.recommendation(project.id), client.catalog(), client.runtime ? client.runtime().catch(() => ({ skillDiscoveryConfigured: false })) : Promise.resolve({ skillDiscoveryConfigured: false })]).then(async ([dev, env, latest, tools, runtime]) => {
      if (!alive) return; setDeveloper(dev.profile); setEnvironment(env.profile); setRecommendation(latest.recommendation); setCatalog(tools); setSelectedIds([]); setError('');
      setDiscoveryEnabled(runtime.skillDiscoveryConfigured === true); setDiscovery(null); setDiscoveryMessage('');
      if (runtime.skillDiscoveryConfigured) {
        const saved = (await client.latestDiscovery(project.id)).discovery; if (!alive) return;
        setDiscovery(saved);
        if (saved?.status === 'FAILED') setDiscoveryMessage(discoveryFailure(saved.errorCode));
        const savedBasisMatches = saved && saved.basis.projectVersion === project.version && saved.basis.developerVersion === (dev.profile?.version ?? 0) && saved.basis.environmentVersion === (env.profile?.version ?? 0);
        const unreflectedSuccess = saved?.status === 'SUCCEEDED' && savedBasisMatches && (latest.recommendation?.discoveryId !== saved.id || latest.recommendation?.validity !== 'CURRENT');
        if (saved && (['QUEUED', 'SEARCHING', 'CHECKING'].includes(saved.status) || unreflectedSuccess)) {
          const sequence = ++requestSequence.current; const abort = new AbortController(); controller.current = abort; setBusy(true);
          try { await awaitDiscovery(saved, { project: project.version, developer: dev.profile?.version ?? 0, environment: env.profile?.version ?? 0 }, sequence, abort.signal); }
          finally { if (alive && sequence === requestSequence.current) setBusy(false); }
        }
      }
    }).catch(failure => { if (alive) setError(errorMessage(failure)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; requestSequence.current++; controller.current?.abort(); };
  }, [project.id, project.version, client, retry]);
  async function requestRecommendation(versions: { project: number; developer: number; environment: number }, savedMessage = '', savedEnvironment = environment?.data) {
    const request = ++requestSequence.current; setBusy(true); setError(''); setSelectedIds([]); setMessage(savedMessage);
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort; setDiscoveryMessage('');
    try {
      const hasCurrent = recommendation?.validity === 'CURRENT' && recommendation.basis.projectVersion === versions.project && recommendation.basis.developerVersion === versions.developer && recommendation.basis.environmentVersion === versions.environment;
      if (!discoveryEnabled || !hasCurrent) { const value = await client.recommend(project.id, versions); if (request === requestSequence.current) setRecommendation(value); }
      if (discoveryEnabled && savedEnvironment?.os?.version && savedEnvironment.client?.id && savedEnvironment.installedComponents !== null) {
        const job = await client.startDiscovery(project.id, versions, abort.signal);
        await awaitDiscovery(job, versions, request, abort.signal);
      }
    }
    catch (failure) { if (request === requestSequence.current) { setError(errorMessage(failure)); if (savedMessage) setMessage(`${savedMessage} 추천은 갱신하지 못했습니다. ‘도구 추천 받기’로 다시 시도하세요.`); } }
    finally { if (request === requestSequence.current) setBusy(false); }
  }
  const dirty = dirtyDeveloper || dirtyEnvironment;
  const current = !!recommendation && recommendation.validity === 'CURRENT' && recommendation.basis.projectVersion === project.version && recommendation.basis.developerVersion === (developer?.version ?? 0) && recommendation.basis.environmentVersion === (environment?.version ?? 0) && (!!recommendation.discoveryId || recommendation.basis.catalogRevision === catalog?.revision);
  const ready = current && !dirty && !loading && !busy && recommendation?.status === 'RECOMMENDED';
  return <div className="recommendations"><section className="panel"><h2>도구 추천</h2><p className="muted">기술스택뿐 아니라 확인한 기능·외부 연동·담당 업무에 맞는 스킬을 skills.sh에서 탐색합니다. 필요한 스킬을 제공하는 라이브러리를 추천하며, 선택한 라이브러리의 공식 설치 안내를 ZIP에 담습니다.</p>
    {error && <div className="error" role="alert">{error}<button type="button" className="secondary" onClick={() => setRetry(value => value + 1)}>저장된 정보 다시 불러오기</button></div>}
    {loading && <p role="status">역할·환경과 저장된 추천을 불러오는 중…</p>}
    {!project.confirmedProfile && <p className="notice">먼저 프로젝트 정보를 검토하고 확인·저장해 주세요.</p>}
    {message && <p role="status">{message}</p>}
    {discoveryMessage && <p role="status">{discoveryMessage}</p>}
    {busy && discovery && <p role="status">{discovery.status === 'CHECKING' ? '후보의 출처·라이선스·파일을 검사하고 적합도를 비교하는 중…' : '프로젝트 기능·업무에 맞는 새 스킬을 찾는 중…'} 최대 180초.</p>}
    {discovery && !busy && discovery.checks.length > 0 && <details><summary>후보 패키지 검사 결과 {discovery.checks.length}개</summary>{discovery.checks.map(check => <p key={check.candidateId}>{check.name} · {check.status === 'PASS' ? '패키지 검사 통과' : `${packageIssues[check.code] ?? '패키지 조건 미충족'} · 추천 제외`}</p>)}</details>}
    {dirty && <p className="notice">변경한 역할·환경을 먼저 저장하세요. 저장하지 않은 변경이 있는 동안 설정 생성은 중단합니다.</p>}
    <button type="button" disabled={loading || busy || dirty || !catalog || !project.confirmedProfile} onClick={() => requestRecommendation({ project: project.version, developer: developer?.version ?? 0, environment: environment?.version ?? 0 })}>{busy ? '필요한 구성 확인 중…' : '도구 추천 받기'}</button>
    {recommendation && <div className="recommendation-result"><h3>{outcomes[recommendation.status]}</h3>{!current && <p className="notice">프로젝트·역할·환경 또는 Catalog가 바뀐 오래된 추천입니다. 다시 추천을 받아 주세요.</p>}
      <p className="muted">{recommendation.evidenceLevel === 'PLAN_ONLY' ? '기획서 기준 제안' : '사용자가 입력한 환경 조건 기준'} · 실제 설치·연결 검사는 수행하지 않았습니다.</p>
      {recommendation.capabilities.map(capability => <p key={capability.id}><strong>{capability.name}</strong> · {capability.reason}</p>)}
      {recommendation.questions.map(question => <p className="notice" key={question.id}>{question.message}</p>)}{recommendation.reasons.map(reason => <p key={reason}>{reason}</p>)}
      {recommendation.items.some(item => !item.required) && <p className="notice">공통 개발 라이브러리는 선택 사항입니다. 필요한 라이브러리만 선택하세요. 공식 설치 안내를 제공하며 자동 설치하지 않습니다.</p>}
      <RecommendationCards items={recommendation.items} catalog={catalog?.items ?? []} ready={!!ready} selectedIds={selectedIds} onSelect={(ids, selected) => setSelectedIds(previous => selected ? [...new Set([...previous, ...ids])] : previous.filter(id => !ids.includes(id)))} />
      {ready && selectedIds.length > 0 && children?.({ recommendation, selectedIds })}
    </div>}
  </section>{!loading && catalog && <div className="workspace-grid"><DeveloperEditor key={`${project.id}-developer-${developer?.version ?? 0}`} initial={developer} disabled={busy} submitLabel={project.confirmedProfile && !dirtyEnvironment ? '역할·업무 저장하고 추천 받기' : undefined} onDirty={() => { setDirtyDeveloper(true); setSelectedIds([]); }} onSave={patch => client.saveDeveloper(project.id, patch)} onSaved={async value => { setDeveloper(value); setDirtyDeveloper(false); if (project.confirmedProfile && !dirtyEnvironment) await requestRecommendation({ project: project.version, developer: value.version, environment: environment?.version ?? 0 }, '역할·업무를 저장했습니다.'); else setMessage('역할·업무를 저장했습니다. 남은 프로젝트·환경 입력을 저장하면 추천을 받을 수 있습니다.'); }} />
    <EnvironmentEditor key={`${project.id}-environment-${environment?.version ?? 0}`} initial={environment} disabled={busy} submitLabel={project.confirmedProfile && !dirtyDeveloper ? '개발환경 저장하고 추천 받기' : undefined} catalog={catalog.items} onDirty={() => { setDirtyEnvironment(true); setSelectedIds([]); }} onSave={patch => client.saveEnvironment(project.id, patch)} onSaved={async value => { setEnvironment(value); setDirtyEnvironment(false); if (project.confirmedProfile && !dirtyDeveloper) await requestRecommendation({ project: project.version, developer: developer?.version ?? 0, environment: value.version }, '사용자가 입력한 환경을 저장했습니다.', value.data); else setMessage('사용자가 입력한 환경을 저장했습니다. 남은 프로젝트·역할 입력을 저장하면 추천을 받을 수 있습니다.'); }} /></div>}
  </div>;
}
