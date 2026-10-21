'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { PROFILE_FIELDS, profileArrayLimit, type ProfileField, type ProfilePatch, type ProjectDto, type ReviewDecision } from '@agentfit/contracts';
import { arrayFields, fromForm, labels, toForm, type FieldForm } from '../lib/profile-form';
import { errorMessage } from '../lib/errors';
import { candidateValues, groupCandidates } from '../lib/review-groups';
import { normalizeProfileValues, profileValueKey } from '../lib/profile-values';
export interface ProfileEditorProps { project: ProjectDto; onSave(patch: ProfilePatch): Promise<ProjectDto>; onSaved?(project: ProjectDto): void; onReload?(): Promise<ProjectDto> }
export function ProfileEditor({ project, onSave, onSaved, onReload }: ProfileEditorProps) {
  const [form, setForm] = useState(() => toForm(project.confirmedProfile?.profile));
  const [baseVersion, setBaseVersion] = useState(project.version);
  const [draft, setDraftState] = useState(project.draft);
  const [actions, setActions] = useState<Record<string, ReviewDecision['action']>>({});
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const [latest, setLatest] = useState<ProjectDto | null>(null); const [compared, setCompared] = useState(false);
  const origins = useRef<Partial<Record<ProfileField, { id: string; before: FieldForm }>>>({});
  const inlineInputs = useRef<Record<string, HTMLTextAreaElement | HTMLSelectElement | null>>({}); const focusCandidate = useRef<string | null>(null);
  const reviewSelects = useRef<Record<string, HTMLSelectElement | null>>({});
  useEffect(() => { const id = focusCandidate.current; if (id) { inlineInputs.current[id]?.focus({ preventScroll: true }); focusCandidate.current = null; } }, [form, actions]);
  const prefix = useId(); const errorRef = useRef<HTMLDivElement>(null);
  const groups = groupCandidates(draft?.result.candidates ?? []);
  const bulkGroups = groups.filter(group => group.field && group.canAccept && group.candidates.every(candidate => actions[candidate.id] === undefined) && form[group.field].mode === 'unknown' && !form[group.field].value);
  const optionalFields = draft ? PROFILE_FIELDS.filter(field => !draft.result.candidates.some(candidate => candidate.field === field) && project.confirmedProfile?.profile[field] == null) : [];
  const groupAction = (key: string) => { const group = groups.find(group => group.key === key); const values = new Set(group?.candidates.map(candidate => actions[candidate.id] ?? 'DEFER')); return values.size === 1 ? [...values][0]! : 'DEFER'; };
  function setDraft(next: ProjectDto['draft']) { setDraftState(next); origins.current = {}; }
  function change(field: ProfileField, value: Partial<FieldForm>) {
    delete origins.current[field];
    setForm(current => ({ ...current, [field]: { ...current[field], ...value } })); setSaved(false);
    setActions(current => Object.fromEntries(Object.entries(current).map(([id, action]) => [id, action === 'ACCEPT' && draft?.result.candidates.find(candidate => candidate.id === id)?.field === field ? 'EDIT' : action])));
  }
  function review(key: string, action: ReviewDecision['action']) {
    const group = groups.find(group => group.key === key); if (!group || (action === 'ACCEPT' && !group.canAccept)) return;
    const field = group.field;
    if (field) {
      if (action === 'ACCEPT' || (action === 'EDIT' && form[field].mode === 'unknown' && !form[field].value)) {
        origins.current[field] = { id: key, before: origins.current[field]?.before ?? { ...form[field] } };
        setForm(current => ({ ...current, [field]: { ...group.proposed } }));
      } else if ((action === 'REJECT' || action === 'DEFER') && origins.current[field]?.id === key) {
        const before = origins.current[field]!.before; setForm(current => ({ ...current, [field]: before })); delete origins.current[field];
      }
      if (action === 'EDIT') focusCandidate.current = key;
    }
    setActions(current => ({ ...current, ...Object.fromEntries(group.candidates.map(candidate => [candidate.id, action])) })); setSaved(false);
  }
  function useCoreFeatures() {
    const group = groups.find(group => group.field === 'features'); if (!group?.values.length) return;
    const before = { ...form.features };
    review(group.key, 'EDIT');
    origins.current.features = { id: group.key, before: origins.current.features?.before ?? before };
    setForm(current => ({ ...current, features: { mode: 'value', value: group.values.join('\n') } }));
    focusCandidate.current = group.key;
  }
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      const profile = fromForm(form);
      const patch: ProfilePatch = { expectedVersion: baseVersion, profile };
      if (draft) {
        patch.draftId = draft.id; patch.draftVersion = draft.version;
        patch.reviewDecisions = draft.result.candidates.map(candidate => {
          const action = actions[candidate.id] ?? 'DEFER';
          return { itemId: candidate.id, version: candidate.version, action, ...(action === 'EDIT' && candidate.field ? { editedValue: profile[candidate.field] } : {}) };
        });
      }
      const result = await onSave(patch); setBaseVersion(result.version); setSaved(true); origins.current = {}; setLatest(null); onSaved?.(result);
    } catch (failure) { setError(errorMessage(failure)); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }
  function renderField(field: ProfileField) {
    return <div className="field" key={field}>
      <label htmlFor={`${prefix}-${field}-mode`}>{labels[field]} 상태</label><select id={`${prefix}-${field}-mode`} value={form[field].mode} onChange={event => change(field, { mode: event.target.value as FieldForm['mode'] })}>
        <option value="unknown">미정</option>{arrayFields.has(field) && <option value="none">명시적으로 없음</option>}<option value="value">직접 입력</option>
      </select>
      {form[field].mode === 'value' && <><label htmlFor={`${prefix}-${field}-value`}>{labels[field]} 값</label>{arrayFields.has(field) ? <textarea id={`${prefix}-${field}-value`} rows={3} value={form[field].value} onChange={event => change(field, { value: event.target.value })} autoComplete="off" aria-describedby={error ? `${prefix}-error` : undefined} /> : <input id={`${prefix}-${field}-value`} value={form[field].value} onChange={event => change(field, { value: event.target.value })} autoComplete="off" aria-describedby={error ? `${prefix}-error` : undefined} />}</>}
      <small>{project.confirmedProfile?.sources[field].source === 'DOCUMENT' ? '저장된 출처: 문서 근거' : project.confirmedProfile?.sources[field].source === 'USER' ? '저장된 출처: 사용자 입력' : '저장된 출처: 미정'}</small>
    </div>;
  }
  return <section className="panel" aria-labelledby={`${prefix}-title`}>
    <div className="section-heading"><div><p className="eyebrow">확인 · 저장</p><h2 id={`${prefix}-title`}>프로젝트 정보</h2></div><span className="badge">{project.confirmedProfile ? '사용자 확인 결과 있음' : '아직 확인하지 않음'}</span></div>
    <p className="muted">미정인 항목을 남겨도 저장할 수 있습니다. 목록은 쉼표 또는 줄바꿈으로 구분합니다.</p>
    <div className="actions review-save"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '확인하고 저장'}</button><span role="status">{saved ? '확인 결과를 저장했습니다.' : '확인이 끝나면 한 번만 저장하세요.'}</span></div>
    {project.version !== baseVersion && <p role="status">최신 저장 결과가 있습니다. 현재 편집값은 유지됩니다.</p>}
    <button type="button" className="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setLatest(onReload ? await onReload() : project); setCompared(false); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>저장된 값 불러오기</button>
    {latest && <div className="draft"><h3>최신 저장값과 현재 편집 비교</h3><p>현재 입력은 보존했습니다. 아래 최신 결과를 확인하고 교체하거나 현재 편집을 유지할지 직접 선택하세요.</p>{PROFILE_FIELDS.map(field => { const value = latest.confirmedProfile?.profile[field]; return <p key={field}><strong>{labels[field]}</strong> · 최신: {value === null || value === undefined ? '미정' : Array.isArray(value) ? value.length ? value.join(', ') : '명시적으로 없음' : value} · 현재: {form[field].mode === 'unknown' ? '미정' : form[field].mode === 'none' ? '명시적으로 없음' : form[field].value}</p>; })}<button type="button" className="secondary" disabled={busy} onClick={() => { setForm(toForm(latest.confirmedProfile?.profile)); setBaseVersion(latest.version); setDraft(latest.draft); setActions({}); origins.current = {}; setLatest(null); setSaved(false); }}>최신 저장값으로 교체</button><label className="checkbox"><input type="checkbox" checked={compared} onChange={e => setCompared(e.target.checked)} />최신 결과와 현재 편집의 차이를 확인했습니다.</label><button type="button" disabled={!compared || busy} onClick={() => { setBaseVersion(latest.version); if (latest.draft?.id !== draft?.id || latest.draft?.version !== draft?.version) { setDraft(latest.draft); setActions({}); origins.current = {}; } setLatest(null); setSaved(false); }}>비교한 최신 기준에 내 편집 유지</button></div>}
    {project.draft?.id !== draft?.id && project.draft && <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(project.draft); setActions({}); origins.current = {}; }}>새 초안 검토</button>}
    {draft && <details open className="draft"><summary>AI 초안 검토 · 사용자 확인 전</summary><p className="muted">정보 묶음 {groups.length}개 · 확인 필요한 묶음 {groups.filter(group => !group.canAccept && group.candidates.some(candidate => !actions[candidate.id] || actions[candidate.id] === 'DEFER')).length}개. 같은 값과 겹치는 목록은 한 번만 표시합니다.</p>
      {draft.result.modelMetadata.inputFormat === 'original-pdf' && <p className="muted">원본 PDF의 표·제목 구조를 함께 분석했습니다. 근거는 추출한 텍스트와 대조했습니다.</p>}
      {draft.result.modelMetadata.secondaryReview && <p className="notice">{(() => { const review = draft.result.modelMetadata.secondaryReview!; if (review.status === 'COMPLETED') return `추가 검토 ${review.targetCount}개 묶음 중 ${review.acceptedCount}개가 원문 검증을 통과했습니다. 나머지는 확인 필요로 남았습니다.`; const reason = { FAILED: '추가 검토에 실패해', SKIPPED_TIME: '추가 검토 시간이 부족해', SKIPPED_UNAVAILABLE: '추가 검토 모델을 사용할 수 없어', SKIPPED_LIMIT: '추가 검토 범위를 초과해' }[review.status]; return `${reason} 첫 분석 결과를 유지했습니다. 확인 필요 항목은 직접 검토할 수 있습니다.`; })()}</p>}
      <button type="button" disabled={busy || !bulkGroups.length} onClick={() => { for (const group of bulkGroups) review(group.key, 'ACCEPT'); }}>명확한 묶음 {bulkGroups.length}개 한 번에 반영</button><p className="muted">기존 입력·검토 선택·충돌 내용은 바꾸지 않습니다. 반영 후 확인하고 저장하세요.</p>
      {groups.map((group, index) => { const action = groupAction(group.key); const field = group.field; const title = field ? labels[field] : '추가 확인'; return <div className="review-group" key={group.key}>
        <div className="review-group-heading"><div><strong>{title}</strong><span className="badge">{action === 'EDIT' ? '사용자 확인·수정 중' : action === 'ACCEPT' ? '반영 선택' : action === 'REJECT' ? '제외 선택' : group.canAccept ? '문서 후보' : '확인 필요'}</span><small>{group.pages.length ? `근거 ${group.pages.join(', ')}쪽` : group.candidates.some(candidate => candidate.evidence.length) ? '근거 위치 있음' : '근거 확인 불가'}</small></div>
          <label>묶음 검토<select ref={node => { reviewSelects.current[group.key] = node; }} aria-label={`${title} 묶음 검토`} value={action} disabled={busy} onChange={event => review(group.key, event.target.value as ReviewDecision['action'])}><option value="DEFER">보류</option><option value="ACCEPT" disabled={!group.canAccept}>문서 내용 반영</option><option value="EDIT" disabled={!field}>확인·수정</option><option value="REJECT">묶음 제외</option></select></label>
        </div>
        {field === 'features' && <><p className="muted">핵심 업무 흐름만 표시합니다. 화면 사양·상태·세부 규칙은 아래에서 확인할 수 있습니다.</p>{group.values.length > 0 ? <button type="button" className="secondary" disabled={busy} onClick={useCoreFeatures}>핵심 기능 {group.values.length}개로 정리</button> : !group.hasNone && <p>핵심 기능을 구분하지 못했습니다. 세부사항을 확인하고 직접 입력하거나 미정으로 남겨 주세요.</p>}</>}
        {action !== 'EDIT' && <><ul className="review-values">{group.values.map(value => { const purposes = [...new Set(group.candidates.flatMap(candidate => candidate.usages ?? []).filter(usage => normalizeProfileValues(field, [usage.value], true).some(item => profileValueKey(item) === profileValueKey(value))).map(usage => usage.purpose))]; return <li key={value}><span>{value}</span>{purposes.length > 0 && <small className="technology-purpose">{purposes.join(' · ')}</small>}</li>; })}</ul>{group.hasNone && <p>명시적으로 없음</p>}{group.hasUnknown && <p>미정인 후보가 포함되어 있습니다.</p>}</>}
        {group.conflict && <p className="review-conflict">{group.hasNone ? '없음과 사용 항목이 함께 나옵니다. 사용할 값 또는 없음을 직접 선택해 주세요.' : '서로 다른 내용이 나옵니다. 함께 쓰는 값인지 확인하거나 필요한 값만 남겨 주세요.'}</p>}
        {action === 'EDIT' && field && <div className="group-edit"><label htmlFor={`${prefix}-${group.key}-edit-mode`}>{title} 수정 상태</label><select ref={node => { if (form[field].mode !== 'value') inlineInputs.current[group.key] = node; }} id={`${prefix}-${group.key}-edit-mode`} disabled={busy} value={form[field].mode} onChange={event => change(field, { mode: event.target.value as FieldForm['mode'] })}><option value="unknown">미정으로 남기기</option>{arrayFields.has(field) && <option value="none">명시적으로 없음</option>}<option value="value">값 입력</option></select>
          {form[field].mode === 'value' && <><label htmlFor={`${prefix}-${group.key}-edit-value`}>{title} 수정</label><textarea ref={node => { inlineInputs.current[group.key] = node; }} id={`${prefix}-${group.key}-edit-value`} rows={Math.min(8, Math.max(2, form[field].value.split(/[,\n]/).length))} disabled={busy} value={form[field].value} onChange={event => change(field, { value: event.target.value })} autoComplete="off" aria-describedby={`${prefix}-${group.key}-help`} /></>}
          {arrayFields.has(field) && form[field].mode === 'value' && <small>{normalizeProfileValues(field, [form[field].value]).length}개 / 최대 {profileArrayLimit(field)}개 · 각 항목 최대 200자</small>}
          <small id={`${prefix}-${group.key}-help`}>{arrayFields.has(field) ? '한 줄에 하나씩 입력하거나 쉼표로 구분하세요. 같은 항목은 한 번만 저장합니다.' : '사용할 값을 확인하고 필요한 내용만 남겨 주세요.'} 이 묶음의 최종 사용자 확인값으로 저장합니다.</small>
        </div>}
        {field && action !== 'EDIT' && form[field].mode !== 'unknown' && <p className="muted">{field === 'features' && form[field].mode === 'value' ? `현재 저장할 기능 ${normalizeProfileValues(field, [form[field].value]).length}개 · 정리 버튼을 누르면 핵심 기능으로 바꿀 수 있습니다.` : `저장할 값: ${form[field].mode === 'none' ? '명시적으로 없음' : form[field].value}`}</p>}
        {group.details.length > 0 && <details className="feature-details"><summary>세부 요구사항 {group.details.length}개 보기</summary><p className="muted">핵심 기능에서 분리한 화면 사양·상태·규칙입니다. 원래 추출값과 근거는 유지하며, 필요한 항목은 직접 추가할 수 있습니다.</p>{group.details.map(value => <p key={value}><span>{value}</span></p>)}</details>}
        <details className="review-evidence"><summary>근거·확인 사항 보기</summary>{group.values.map(value => { const candidates = group.candidates.filter(candidate => candidateValues(candidate).some(item => profileValueKey(item) === profileValueKey(value))); const pages = [...new Set(candidates.flatMap(candidate => candidate.evidence.flatMap(evidence => evidence.page ? [evidence.page] : [])))].sort((a, b) => a - b); return <p key={value}>{value} · {pages.length ? `근거 ${pages.join(', ')}쪽` : candidates.some(candidate => candidate.evidence.length) ? '근거 위치 있음' : '근거 확인 불가'}{candidates.some(candidate => candidate.status !== 'suggested') ? ' · 문서 해석 확인 필요' : ''}</p>; })}{group.hasNone && <p>없음으로 나온 근거도 포함되어 있습니다.</p>}{group.hasUnknown && <p>값을 확인하지 못한 후보가 포함되어 있습니다.</p>}<p className="muted">원래 후보와 모든 근거 위치를 유지합니다. 원문 인용은 보관하지 않습니다.</p></details>
        {index < groups.length - 1 && <button type="button" className="secondary next-group" disabled={busy} onClick={() => reviewSelects.current[groups[index + 1]!.key]?.focus()}>다음 묶음</button>}
      </div>; })}
      {!draft.result.candidates.length && <p>적용할 후보가 없습니다. 아래에서 직접 작성할 수 있습니다.</p>}
    </details>}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <details className="final-profile" open={!draft}><summary>최종 값 직접 편집</summary><fieldset disabled={busy}><legend className="sr-only">확인할 프로젝트 정보</legend><div className="profile-grid">
        {PROFILE_FIELDS.filter(field => !optionalFields.includes(field)).map(renderField)}
      </div>{optionalFields.length > 0 && <details className="draft"><summary>문서에 없는 정보 {optionalFields.length}개 · 선택 입력</summary><p className="muted">문서에서 확인하지 못한 정보입니다. 모두 미정으로 남겨도 저장하고 진행할 수 있습니다.</p><div className="profile-grid">{optionalFields.map(renderField)}</div></details>}</fieldset></details>
      {error && <div role="alert" className="error" id={`${prefix}-error`} ref={errorRef} tabIndex={-1}>{error}</div>}
    </form>
  </section>;
}
