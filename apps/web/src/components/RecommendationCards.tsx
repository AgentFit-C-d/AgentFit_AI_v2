import { skillLibrary, SKILL_RECOMMENDATION_MIN_SCORE, type RecommendationItem, type SkillToolMetadata, type SkillLibrary } from '@agentfit/contracts';
import type { apiClient } from '../lib/api';

type CatalogTool = Awaited<ReturnType<typeof apiClient.catalog>>['items'][number];
interface Entry { item: RecommendationItem; tool?: CatalogTool | SkillToolMetadata }
interface Selection { ready: boolean; selectedIds: string[]; onSelect(ids: string[], selected: boolean): void }
const riskLabel = (risk?: string) => ({ LOW: '낮음', MEDIUM: '보통', HIGH: '높음' }[risk ?? ''] ?? '미확인');
function MatchScore({ score }: { score?: number }) {
  return score === undefined ? null : <p className="notice">프로젝트 적합도 {score}점 · {score >= SKILL_RECOMMENDATION_MIN_SCORE ? '추천 기준 충족' : `추가 선택 후보 · 추천 기준 ${SKILL_RECOMMENDATION_MIN_SCORE}점`}</p>;
}
function SkillCard({ entry: { item, tool }, ready, selectedIds, onSelect }: Selection & { entry: Entry }) {
  const name = tool?.name ?? item.catalogItemId;
  return <article className="tool-card">
    <span className="badge">{item.category === 'PROJECT' ? '프로젝트 기능·업무별 지침 · 선택' : item.required ? '기술·업무별 구성' : '공통 개발 지침 · 선택'}</span>
    <label className="checkbox"><input type="checkbox" aria-label={`${name} 선택`} disabled={!ready} checked={selectedIds.includes(item.catalogItemId)} onChange={e => onSelect([item.catalogItemId], e.target.checked)} />{name} · {item.required ? '최소 구성에 필요' : '선택 사항'}</label>
    <p>{item.reason}</p>
    <MatchScore score={item.matchScore} />
    <small>고정 버전 {item.catalogVersion}<br />{item.tool ? '패키지 검사 통과 · 실제 사용 미검증 · 전체 구성 조합 미검증' : tool ? '대표 검사 기록: Windows 11 · Codex 26.930.4958.0 · 자연어 지침 사용/발견. Skill 추천 조건에는 앱 버전을 사용하지 않습니다.' : '고정 버전 메타데이터 미확인 · 추천을 다시 받아 주세요.'} 위험도 {riskLabel(tool?.risk)} · 라이선스 {tool?.license ?? '미확인'}</small>
    {tool && <p><a className="text-link" href={tool.skillsUrl} target="_blank" rel="noopener noreferrer">공급원·Skill 내용 확인</a></p>}
    {!item.permissionOptions.length && <p className="notice">자연어 Skill 지침입니다. 실행 권한을 차단하거나 외부 연결을 승인하는 정책은 생성하지 않습니다.</p>}
    {item.permissionOptions.map(option => <p key={option.key}>요구 권한: {option.resourceScope} · 선택 가능한 정책 {option.supportedPolicies.join(', ')}</p>)}
    {item.authenticationRequirements.map(auth => <p key={auth.serviceId}>{auth.serviceId}: {auth.state === 'READY' ? '준비했다고 입력' : auth.state === 'NOT_READY' ? '준비 필요' : '준비 미확인'} · {auth.instructions}</p>)}
  </article>;
}
function LibraryCard({ library, entries, ...selection }: Selection & { library: SkillLibrary; entries: Entry[] }) {
  const ids = entries.map(entry => entry.item.catalogItemId);
  const selected = ids.filter(id => selection.selectedIds.includes(id)).length;
  const all = selected === ids.length;
  const packageOnly = entries.some(entry => entry.item.tool);
  const risks = [...new Set(entries.map(entry => riskLabel(entry.tool?.risk)))];
  const licenses = [...new Set(entries.map(entry => entry.tool?.license ?? '미확인'))];
  const versions = [...new Set(entries.map(entry => entry.item.catalogVersion))];
  const reasons = [...new Set(entries.map(entry => entry.item.reason))];
  const scores = entries.flatMap(entry => entry.item.matchScore === undefined ? [] : [entry.item.matchScore]);
  const score = scores.length ? Math.max(...scores) : undefined;
  const optional = entries.every(entry => entry.item.matchScore !== undefined && entry.item.matchScore < SKILL_RECOMMENDATION_MIN_SCORE);
  return <article className="tool-card library-card" aria-label={`${library.name} 추천 라이브러리`}>
    <span className="badge">{optional ? '추가 선택 스킬 라이브러리' : '추천 스킬 라이브러리'}</span>
    <label className="checkbox"><input type="checkbox" aria-label={`${library.name} 라이브러리 선택`} checked={all} disabled={!selection.ready} onChange={event => selection.onSelect(ids, event.target.checked)} /><strong>{library.name}</strong></label>
    <p>{library.description}</p>
    <p>{reasons.join(' ')}</p>
    <MatchScore score={score} />
    <small>추천 근거 버전 {versions.join(' · ')}<br />{packageOnly ? '추천 근거는 패키지 검사 범위입니다.' : '추천 근거는 개별 스킬의 대표 검사 기록입니다.'} 라이브러리 전체·실제 설치·사용은 미검증입니다. 근거 스킬 위험도 {risks.join(' · ')} · 라이선스 {licenses.join(' · ')}</small>
    <p><a className="text-link" href={library.installationUrl} target="_blank" rel="noopener noreferrer">{library.name} 공식 설치 안내</a></p>
    <p className="notice">ZIP에는 라이브러리 공식 설치 안내를 담습니다. 개별 스킬 파일은 포함하지 않습니다.</p>
    {entries.flatMap(({ item }) => item.permissionOptions.map(option => <p key={`${item.catalogItemId}-${option.key}`}>요구 권한: {option.resourceScope} · {option.supportedPolicies.join(', ')}</p>))}
    {entries.flatMap(({ item }) => item.authenticationRequirements.map(auth => <p key={`${item.catalogItemId}-${auth.serviceId}`}>인증: {auth.serviceId} · {auth.state === 'READY' ? '준비했다고 입력' : auth.state === 'NOT_READY' ? '준비 필요' : '준비 미확인'}</p>))}
  </article>;
}
export function RecommendationCards({ items, catalog, ...selection }: Selection & { items: RecommendationItem[]; catalog: CatalogTool[] }) {
  const groups = new Map<string, { library?: SkillLibrary; entries: Entry[] }>();
  for (const item of items) {
    const tool = item.tool ?? catalog.find(candidate => candidate.id === item.catalogItemId && candidate.version === item.catalogVersion);
    const library = skillLibrary(tool?.skillsUrl);
    const key = library ? library.repository : `item:${item.catalogItemId}`;
    const group = groups.get(key) ?? { library, entries: [] };
    group.entries.push({ item, tool }); groups.set(key, group);
  }
  return [...groups].map(([key, group]) => group.library
    ? <LibraryCard key={key} library={group.library} entries={group.entries} {...selection} />
    : group.entries.map(entry => <SkillCard key={entry.item.catalogItemId} entry={entry} {...selection} />));
}
