'use client';
import type { RecommendationDto, Preview, PreviewInput, ConfigurationPolicy } from '@agentfit/contracts';
import { apiClient } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import { PermissionEditor } from './PermissionEditor';
import { ConfigurationHistory } from './ConfigurationHistory';
import { errorMessage } from '../lib/errors';
export interface ConfigurationPanelProps { projectId: string; recommendation: RecommendationDto; selectedIds: string[]; client?: typeof apiClient; onDownload?(blob: Blob, id: string): void }
export function ConfigurationPanel({ projectId, recommendation, selectedIds, client = apiClient, onDownload = download }: ConfigurationPanelProps) {
  const [policies, setPolicies] = useState<ConfigurationPolicy[]>(() => recommendation.items.filter(x => selectedIds.includes(x.catalogItemId)).flatMap(item => item.permissionOptions.map(option => ({ catalogItemId: item.catalogItemId, key: option.key, resourceScope: option.resourceScope, mappingId: option.mapping, policy: 'ASK_EACH_TIME' as const }))));
  const [existingState, setExistingState] = useState<PreviewInput['existingState']>('UNKNOWN'); const [existingFiles, setExistingFiles] = useState<PreviewInput['existingFiles']>([]);
  const [targets, setTargets] = useState<{ targetKey: string; relativePath: string }[]>([]); const [customEnabled, setCustomEnabled] = useState(false); const [custom, setCustom] = useState({ name: '', description: '', instructions: '' });
  const [preview, setPreview] = useState<Preview | null>(null); const [submitted, setSubmitted] = useState<PreviewInput | null>(null); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [refresh, setRefresh] = useState(0);
  const generation = useRef(0); const pending = useRef<AbortController | null>(null); useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  const customDetails = useRef<HTMLDetailsElement | null>(null); const customName = useRef<HTMLInputElement | null>(null); const customDescription = useRef<HTMLInputElement | null>(null); const customInstructions = useRef<HTMLTextAreaElement | null>(null);
  const validateCustom = () => {
    if (!customEnabled) return true;
    const missing = !custom.name.trim() ? customName : !custom.description.trim() ? customDescription : !custom.instructions.trim() ? customInstructions : null;
    const tooLong = Array.from(custom.description).length > 200 ? customDescription : Array.from(custom.instructions).length > 10000 ? customInstructions : null;
    const field = missing ?? tooLong;
    if (!field) return true;
    setError(missing ? '내 작업 규칙 Skill의 이름·설명·작업 규칙을 모두 입력해 주세요. 추가 규칙이 필요 없다면 ‘내 작업 규칙 Skill 추가’ 체크를 해제하세요.' : tooLong === customDescription ? 'Skill 설명은 200자까지 입력할 수 있습니다. 입력을 보존했으니 설명을 줄여 주세요.' : '자연어 작업 규칙은 10,000자까지 입력할 수 있습니다. 입력을 보존했으니 규칙을 줄여 주세요.');
    if (customDetails.current) customDetails.current.open = true;
    field.current?.focus();
    return false;
  };
  const invalidate = () => { generation.current++; pending.current?.abort(); pending.current = null; setPreview(null); setSubmitted(null); setConfirmed(false); setError(''); setMessage(''); };
  const clear = () => { invalidate(); setBusy(false); setTargets([]); setExistingState('UNKNOWN'); setExistingFiles([]); setCustomEnabled(false); setCustom({ name: '', description: '', instructions: '' }); };
  const denied = policies.some(p => p.policy === 'DENY' && recommendation.items.find(x => x.catalogItemId === p.catalogItemId)?.required);
  return <div className="configuration"><section className="panel"><h3>설정 검토</h3><PermissionEditor recommendation={recommendation} selectedIds={selectedIds} policies={policies} disabled={busy} onChange={value => { invalidate(); setPolicies(value); }} />
    <fieldset disabled={busy}><legend>기존 파일 비교 범위</legend><p className="muted">비밀값을 제거한 파일만 제공하세요. 본문은 현재 검토 중에만 사용하며 서버에 저장하지 않습니다.</p><label>기존 설정 확인<select value={existingState} onChange={e => { invalidate(); setExistingState(e.target.value as PreviewInput['existingState']); if (e.target.value !== 'PROVIDED') setExistingFiles([]); }}><option value="UNKNOWN">기존 파일 미확인</option><option value="USER_SAYS_EMPTY">기존 설정이 없다고 입력</option><option value="PROVIDED" disabled={!targets.length}>선택한 파일 본문 제공</option></select></label>
      {existingState === 'PROVIDED' && <><p>비교할 파일만 추가하세요. 관리 블록이 없는 기존 파일은 덮어쓰지 않고 충돌로 중단합니다.</p>{existingFiles.map((file, index) => <div key={index}><label>비교 파일 {index + 1}<select value={file.relativePath} onChange={e => { invalidate(); const target = targets.find(x => x.relativePath === e.target.value)!; setExistingFiles(previous => previous.map((x, i) => i === index ? { ...target, content: x.content } : x)); }}>{targets.map(target => <option key={target.relativePath} value={target.relativePath}>{target.relativePath}</option>)}</select></label><label>기존 파일 본문 {index + 1}<textarea maxLength={200000} value={file.content} onChange={e => { invalidate(); setExistingFiles(previous => previous.map((x, i) => i === index ? { ...x, content: e.target.value } : x)); }} /></label><button type="button" className="secondary" onClick={() => { invalidate(); setExistingFiles(previous => previous.filter((_, i) => i !== index)); }}>비교 파일 {index + 1} 제외</button></div>)}<button type="button" className="secondary" disabled={existingFiles.length >= 20} onClick={() => { invalidate(); setExistingFiles(previous => [...previous, { ...targets[0]!, content: '' }]); }}>비교 파일 추가</button></>}
      <details ref={customDetails}><summary>내 작업 규칙 추가</summary><label className="checkbox"><input type="checkbox" checked={customEnabled} onChange={e => { invalidate(); setCustomEnabled(e.target.checked); }} />내 작업 규칙 Skill 추가</label>{customEnabled && <><label>Skill 이름<input ref={customName} maxLength={64} value={custom.name} onChange={e => { invalidate(); setCustom({ ...custom, name: e.target.value }); }} placeholder="my-review-guide" /></label><label>Skill 설명<input ref={customDescription} maxLength={400} value={custom.description} onChange={e => { invalidate(); setCustom({ ...custom, description: e.target.value }); }} /></label><small>200자까지 입력할 수 있습니다.</small><label>자연어 작업 규칙<textarea ref={customInstructions} maxLength={20000} value={custom.instructions} onChange={e => { invalidate(); setCustom({ ...custom, instructions: e.target.value }); }} /></label><small>10,000자까지 입력할 수 있습니다.</small><p>자연어 업무 규칙만 입력하세요. 실행 코드·명령·외부 URL·비밀값은 받지 않습니다.</p></>}</details>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="actions"><button type="button" disabled={busy || denied || !selectedIds.length} onClick={async () => {
      invalidate(); if (!validateCustom()) return;
      const input: PreviewInput = { recommendationId: recommendation.id, expectedBasis: recommendation.basis, selectedToolIds: selectedIds, permissionPolicies: policies, existingState, existingFiles, ...(customEnabled ? { customSkill: custom } : {}) };
      const request = generation.current; const controller = new AbortController(); pending.current = controller; setBusy(true);
      try { const value = await client.preview(projectId, input, controller.signal); if (request !== generation.current) return; setPreview(value); setSubmitted(input); setTargets(value.files.map(({ targetKey, relativePath }) => ({ targetKey, relativePath }))); }
      catch (e) { if (request === generation.current) setError(errorMessage(e)); } finally { if (request === generation.current) setBusy(false); }
    }}>{busy ? '설정 처리 중…' : '설정 미리보기 만들기'}</button><button type="button" className="secondary" onClick={clear}>설정 검토 취소</button></div>
    {preview && <div className="config-preview"><h4>생성할 파일 · 최종 검토</h4><p>10분 내 승인·다운로드하세요. 파일을 제공하지 않은 경로는 신규 설정안이며 실제 PC 변경을 뜻하지 않습니다.</p>{preview.warnings.map(w => <p className="notice" key={w.code}>{w.message}</p>)}<p className="muted">승인 지문 {preview.fingerprint}</p>{preview.files.map(file => <details key={file.relativePath}><summary>{file.relativePath} · {file.action === 'PROPOSAL' ? '기존 미확인 · 설정안' : '제공한 파일 비교'}</summary><p className="muted">생성 SHA256 {file.afterHash}{file.beforeHash && <><br />원본 SHA256 {file.beforeHash}</>}</p><pre>{file.content}</pre>{file.diff !== null && <><h5>제공한 파일과 차이</h5><pre>{file.diff}</pre></>}</details>)}
      <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />표시된 파일과 확인 범위를 검토했고 이 내용의 생성을 승인합니다.</label><button type="button" disabled={!confirmed || busy || !submitted} onClick={async () => {
        const request = generation.current; const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
        try { const approval = await client.approve(projectId, { previewId: preview.id, previewFingerprint: preview.fingerprint, confirmation: true }, controller.signal); if (request !== generation.current) return;
          const result = await client.export(projectId, { approvalId: approval.id, previewId: preview.id, previewFingerprint: preview.fingerprint, input: submitted! }, controller.signal); if (request !== generation.current) return;
          onDownload(result.blob, result.configurationId); clear(); setRefresh(x => x + 1); setMessage('다운로드를 시작했습니다. 설치·연결·검증은 아직 수행하지 않았습니다. ZIP의 적용 안내를 확인하세요.');
        } catch (e) { if (request === generation.current) setError(errorMessage(e)); } finally { if (request === generation.current) setBusy(false); }
      }}>최종 승인하고 ZIP 다운로드</button></div>}
  </section><ConfigurationHistory projectId={projectId} client={client} refresh={refresh} /></div>;
}
function download(blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'agentfit-config.zip'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
