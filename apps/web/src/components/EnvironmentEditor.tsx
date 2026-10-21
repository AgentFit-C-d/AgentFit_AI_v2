'use client';
import type { EnvironmentProfile, ProfilePut, StoredProfile } from '@agentfit/contracts';
import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { DeclaredRows } from './DeclaredRows';
export interface EnvironmentEditorProps { initial: StoredProfile<EnvironmentProfile> | null; onSave(patch: ProfilePut<EnvironmentProfile>): Promise<StoredProfile<EnvironmentProfile>>; onSaved(value: StoredProfile<EnvironmentProfile>): void | Promise<void>; onDirty(): void; catalog: { id: string; name: string; version: string }[]; submitLabel?: string; disabled?: boolean }
const emptyEnvironment: EnvironmentProfile = { os: null, client: null, runtimes: null, installedComponents: null, configurationKnowledge: 'UNKNOWN', authenticationReadiness: null };
export function EnvironmentEditor({ initial, catalog, onSave, onSaved, onDirty, submitLabel = '개발환경 저장', disabled = false }: EnvironmentEditorProps) {
  const [data, setData] = useState<EnvironmentProfile>(() => structuredClone(initial?.data ?? emptyEnvironment)); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const change = (value: Partial<EnvironmentProfile>) => { setData(current => ({ ...current, ...value })); setSaved(false); onDirty(); };
  return <section className="panel"><h2>개발환경</h2><p className="notice">직접 입력한 내용이며 PC 검사 결과가 아닙니다. 비밀번호·API 키는 입력하지 마세요. 확인하지 않은 항목은 미정으로 남겨도 됩니다.</p>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const value = await onSave({ expectedVersion: initial?.version ?? 0, data }); await onSaved(value); setSaved(true); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}><fieldset disabled={busy || disabled}>
      <div className="profile-grid"><label>OS 종류<select value={data.os?.family ?? ''} onChange={e => change({ os: e.target.value ? { family: e.target.value as NonNullable<EnvironmentProfile['os']>['family'], version: data.os?.version ?? null } : null })}><option value="">미정</option><option value="WINDOWS">Windows</option><option value="MACOS">macOS</option><option value="LINUX">Linux</option><option value="OTHER">기타</option></select></label>
      <label>OS 버전<input value={data.os?.version ?? ''} disabled={!data.os} placeholder="예: 11" onChange={e => change({ os: data.os ? { ...data.os, version: e.target.value || null } : null })} /></label>
      <label>AI 개발 도구<select value={data.client?.id ?? ''} onChange={e => change({ client: e.target.value ? { id: e.target.value, version: data.client?.version ?? null } : null })}><option value="">미정</option><option value="codex-desktop">Codex 앱</option>{data.client && data.client.id !== 'codex-desktop' && <option value={data.client.id}>{data.client.id}</option>}</select></label>
      </div>
      <DeclaredRows label="기존 확장" value={data.installedComponents} emptyRow={{ catalogItemId: null, name: '', version: null }} fields={[{ key: 'catalogItemId', label: '알고 있는 도구', nullable: true, choices: catalog.map(x => ({ value: x.id, label: x.name })) }, { key: 'name', label: '확장 이름' }, { key: 'version', label: '설치한 고정 버전', nullable: true }]} onChange={installedComponents => change({ installedComponents })} />
      <details><summary>추가 환경 정보 (선택)</summary>
        <label>기존 설정 파일<select value={data.configurationKnowledge} onChange={e => change({ configurationKnowledge: e.target.value as EnvironmentProfile['configurationKnowledge'] })}><option value="UNKNOWN">미확인</option><option value="USER_SAYS_EMPTY">없음이라고 확인</option><option value="HAS_EXISTING">기존 파일 있음</option></select></label>
        <DeclaredRows label="런타임" value={data.runtimes} emptyRow={{ name: '', version: null }} fields={[{ key: 'name', label: '런타임 이름' }, { key: 'version', label: '런타임 버전', nullable: true }]} onChange={runtimes => change({ runtimes })} />
        <p className="muted">기존 Skill의 고정 버전은 설치한 원본 commit 또는 AgentFit 적용 안내의 버전을 확인하세요. 인증 준비는 사용자 진술로만 기록합니다.</p>
        <DeclaredRows<NonNullable<EnvironmentProfile['authenticationReadiness']>[number]> label="인증 준비" value={data.authenticationReadiness} emptyRow={{ serviceId: '', state: 'UNKNOWN' }} fields={[{ key: 'serviceId', label: '서비스 이름' }, { key: 'state', label: '준비 여부', choices: [{ value: 'UNKNOWN', label: '미정' }, { value: 'READY', label: '준비했다고 확인' }, { value: 'NOT_READY', label: '준비 안 됨' }] }]} onChange={authenticationReadiness => change({ authenticationReadiness })} />
      </details><p className="muted">자연어 Skill 추천에는 Codex 앱 버전 입력이 필요하지 않습니다. 실제 Skill 인식·사용 여부는 적용 후 확인하세요.</p>
      {error && <p role="alert" className="error">{error}</p>}<div className="actions"><button type="submit">{busy ? '저장 중…' : submitLabel}</button>{saved && <span role="status">사용자가 입력한 환경을 저장했습니다.</span>}</div></fieldset></form></section>;
}
