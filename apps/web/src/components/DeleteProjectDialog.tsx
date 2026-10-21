'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors';
export function DeleteProjectDialog({ name, onDelete, onCancel }: { name: string; onDelete(): Promise<void>; onCancel(): void }) {
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const prefix = useId(); const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => previous?.focus(); }, []);
  return <div className="modal-backdrop"><div ref={dialog} className="panel modal" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-title`} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onCancel();
    if (event.key === 'Tab') { const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]; const first = nodes[0]; const last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><h2 id={`${prefix}-title`}>“{name}” 프로젝트 삭제</h2><p>프로젝트 정보·분석 초안·확인 기록을 함께 제거합니다. 이 작업은 되돌릴 수 없습니다.</p>
    <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />분석 결과와 확인 기록도 함께 삭제합니다</label>
    {error && <div role="alert" className="error">{error}</div>}
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="danger" disabled={!confirmed || busy} onClick={async () => { setBusy(true); setError(''); try { await onDelete(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}>{busy ? '삭제 중…' : '프로젝트 삭제'}</button></div>
  </div></div>;
}
