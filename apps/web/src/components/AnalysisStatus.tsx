'use client';
import { useState } from 'react';
import type { AttemptDto } from '@agentfit/contracts';
import { errorMessage } from '../lib/errors';
const labels: Record<AttemptDto['status'], string> = { QUEUED: '분석 대기 중', PROCESSING: '문서를 분석하는 중', SUCCEEDED: '분석 초안 준비 완료', FAILED: '분석 실패', CANCELLED: '분석 취소됨' };
export function AnalysisStatus({ attempt, onCancel }: { attempt: AttemptDto; onCancel(): Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const active = attempt.status === 'QUEUED' || attempt.status === 'PROCESSING';
  return <section className="status panel" aria-label="분석 상태"><h2 aria-live="polite">{labels[attempt.status]}</h2><p>{active ? '접수부터 최대 180초 동안 처리합니다. 확인된 정보는 그대로 유지됩니다.' : attempt.status === 'SUCCEEDED' ? '새 초안을 검토해 주세요. 사용자 확인 결과로 자동 저장하지 않습니다.' : attempt.status === 'FAILED' ? errorMessage(new Error(attempt.errorCode ?? 'ANALYSIS_FAILED')) : '다시 분석하려면 문서를 새로 입력해 주세요.'}</p>{active && <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onCancel(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}>{busy ? '취소 요청 중…' : '분석 취소'}</button>}{error && <p role="alert" className="error">{error}</p>}</section>;
}
