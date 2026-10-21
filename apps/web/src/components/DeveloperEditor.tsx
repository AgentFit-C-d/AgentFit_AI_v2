'use client';
import type { DeveloperProfile, ProfilePut, StoredProfile } from '@agentfit/contracts';
import { useState } from 'react';
import { errorMessage } from '../lib/errors';
export interface DeveloperEditorProps { initial: StoredProfile<DeveloperProfile> | null; onSave(patch: ProfilePut<DeveloperProfile>): Promise<StoredProfile<DeveloperProfile>>; onSaved(value: StoredProfile<DeveloperProfile>): void | Promise<void>; onDirty(): void; submitLabel?: string; disabled?: boolean }
export function DeveloperEditor({ initial, onSave, onSaved, onDirty, submitLabel = '역할·업무 저장', disabled = false }: DeveloperEditorProps) {
  const [role, setRole] = useState(initial?.data.role ?? ''); const [experience, setExperience] = useState(initial?.data.experienceLevel ?? '');
  const [mode, setMode] = useState(initial?.data.responsibilities === null || !initial ? 'unknown' : initial.data.responsibilities.length ? 'known' : 'none');
  const [work, setWork] = useState(initial?.data.responsibilities?.join('\n') ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const changed = () => { onDirty(); setSaved(false); };
  return <section className="panel"><h2>내 역할·업무</h2><p className="muted">한 사람이 여러 역할을 맡아도 괜찮습니다. 주요 업무로 구체적인 필요를 판단합니다.</p>
    <form onSubmit={async event => { event.preventDefault(); setError(''); if (mode === 'known' && !work.trim()) { setError('업무를 입력하거나 없음·미정을 선택해 주세요.'); return; } setBusy(true); try { const data: DeveloperProfile = { role: role as DeveloperProfile['role'] || null, experienceLevel: experience as DeveloperProfile['experienceLevel'] || null, responsibilities: mode === 'unknown' ? null : mode === 'none' ? [] : work.split('\n').map(x => x.trim()).filter(Boolean) }; const value = await onSave({ expectedVersion: initial?.version ?? 0, data }); await onSaved(value); setSaved(true); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}>
      <fieldset disabled={busy || disabled}><div className="profile-grid">
        <label>개발 역할<select value={role} onChange={e => { setRole(e.target.value as typeof role); changed(); }}><option value="">미정</option><option value="FRONTEND">프론트엔드</option><option value="BACKEND">백엔드</option><option value="FULL_STACK">전체 개발</option><option value="AI">AI</option><option value="DESIGNER">디자인</option></select></label>
      </div><details><summary>업무·경험 추가 입력 (선택)</summary><div className="profile-grid">
        <label>경험 수준<select value={experience} onChange={e => { setExperience(e.target.value as typeof experience); changed(); }}><option value="">미정</option><option value="BEGINNER">초보</option><option value="INTERMEDIATE">중급</option><option value="EXPERIENCED">숙련</option></select></label>
        <label>주요 업무 상태<select value={mode} onChange={e => { setMode(e.target.value); changed(); }}><option value="unknown">미정</option><option value="none">없음</option><option value="known">직접 입력</option></select></label>
      </div>{mode === 'known' && <label>주요 업무 입력<textarea value={work} rows={3} onChange={e => { setWork(e.target.value); changed(); }} placeholder="한 줄에 한 업무 · 최대 30개" /></label>}</details>
      {error && <p role="alert" className="error">{error}</p>}<div className="actions"><button type="submit">{busy ? '저장 중…' : submitLabel}</button>{saved && <span role="status">입력한 역할·업무를 저장했습니다.</span>}</div></fieldset>
    </form></section>;
}
