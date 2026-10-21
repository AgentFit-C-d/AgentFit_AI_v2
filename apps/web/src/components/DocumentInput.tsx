'use client';
import { useId, useRef, useState } from 'react';
import { codePointLength, type ProviderId } from '@agentfit/contracts';
import { errorMessage } from '../lib/errors';
export interface DocumentInputProps { disabled?: boolean; onText(text: string, provider: ProviderId): Promise<void>; onFile(file: File, provider: ProviderId): Promise<void> }
export function DocumentInput({ disabled, onText, onFile }: DocumentInputProps) {
  const [mode, setMode] = useState('text'); const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [provider, setProvider] = useState<ProviderId>('solar'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const prefix = useId(); const errorRef = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null);
  async function submit() {
    setError('');
    if (mode === 'text' && (!text.trim() || codePointLength(text) > 100000)) { setError('비어 있지 않은 텍스트를 100,000자 이내로 입력해 주세요. 공백과 줄바꿈도 포함합니다.'); return; }
    if (mode === 'file' && (!file || !file.size || file.size > 10485760 || !/\.(pdf|md|markdown)$/i.test(file.name))) { setError('PDF 또는 Markdown 파일 하나를 선택해 주세요. 최대 10MiB까지 허용합니다.'); return; }
    setBusy(true);
    try { if (mode === 'text') await onText(text, provider); else await onFile(file!, provider); setText(''); setFile(null); if (fileRef.current) fileRef.current.value = ''; }
    catch (failure) { setError(errorMessage(failure)); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-labelledby={`${prefix}-title`}>
    <p className="eyebrow">문서에서 시작</p><h2 id={`${prefix}-title`}>기획서 분석</h2>
    <p className="notice">선택한 모델 서비스에 문서 내용을 전송합니다. API 키·비밀번호는 넣지 마세요. 원문은 처리 후 삭제하며, 클라우드에서는 비공개 임시 저장소를 사용합니다. 중단된 업로드도 10분 내 정리를 목표로 합니다. 외부 모델의 보관 조건은 해당 서비스 정책을 따릅니다.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={disabled || busy}><legend className="sr-only">문서 입력</legend>
      <div className="input-options"><label>입력 방식<select value={mode} onChange={event => setMode(event.target.value)}><option value="text">텍스트 직접 입력</option><option value="file">PDF · Markdown 파일</option></select></label>
      <label>분석 모델<select value={provider} onChange={event => setProvider(event.target.value as ProviderId)}><option value="solar">Upstage · Solar Pro 4 (유료)</option><option value="upstage">Upstage · Information Extract (유료)</option></select></label></div>
      {provider === 'upstage' && <p className="notice">PDF는 원본 파일을 Upstage에 전송해 표·제목 구조를 함께 분석합니다. 애매한 항목이 남으면 해당 값과 주변 근거만 Solar Pro 4에 한 번 추가 전송해 검토합니다. 추가 검토가 실패하거나 시간이 부족하면 첫 분석 결과를 유지합니다.</p>}
      {mode === 'text' ? <><label htmlFor={`${prefix}-text`}>기획서 텍스트</label><textarea id={`${prefix}-text`} rows={8} value={text} onChange={event => setText(event.target.value)} aria-describedby={`${prefix}-limits`} autoComplete="off" /><small>{codePointLength(text).toLocaleString()} / 100,000자</small></> : <label>PDF 또는 Markdown 파일<input ref={fileRef} type="file" accept=".pdf,.md,.markdown" onChange={event => setFile(event.target.files?.[0] ?? null)} aria-describedby={`${prefix}-limits`} /></label>}
      <p className="muted" id={`${prefix}-limits`}>한 번에 문서 하나 · 최대 10MiB · PDF 최대 100쪽 · 텍스트 100,000자. 이미지 OCR과 자동 절단은 지원하지 않습니다.</p>
      <button type="submit">{busy ? '접수 중…' : '분석 시작'}</button>
    </fieldset></form>
    {error && <div role="alert" className="error" ref={errorRef} tabIndex={-1}>{error}</div>}
  </section>;
}
