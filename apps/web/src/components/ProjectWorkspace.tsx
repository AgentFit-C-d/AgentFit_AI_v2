'use client';
import { useEffect, useState } from 'react';
import type { AttemptDto, ProjectDto } from '@agentfit/contracts';
import { apiClient } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { DocumentInput } from './DocumentInput';
import { ProfileEditor } from './ProfileEditor';
import { AnalysisStatus } from './AnalysisStatus';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { RecommendationPanel } from './RecommendationPanel';
import { ConfigurationPanel } from './ConfigurationPanel';
export function ProjectWorkspace({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDto | null>(null); const [attempt, setAttempt] = useState<AttemptDto | null>(null); const [error, setError] = useState(''); const [deleting, setDeleting] = useState(false);
  useEffect(() => { let alive = true; void apiClient.project(id).then(value => { if (alive) { setProject(value); setAttempt(value.activeAttempt); } }).catch(failure => { if (alive) setError(errorMessage(failure)); }); return () => { alive = false; }; }, [id]);
  const active = attempt?.status === 'QUEUED' || attempt?.status === 'PROCESSING';
  useEffect(() => {
    if (!active || !attempt) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await apiClient.attempt(id, attempt!.id); if (!alive) return; setAttempt(next); setError(''); if (next.status === 'SUCCEEDED') setProject(await apiClient.project(id)); }
      catch (failure) { if (alive) setError(errorMessage(failure)); }
      finally { if (alive) timer = setTimeout(() => { void poll(); }, 1000); }
    }
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { alive = false; clearTimeout(timer); };
  }, [id, active, attempt?.id]);
  if (!project) return <section className="panel">{error ? <div role="alert" className="error">{error}<p><a href="/projects">프로젝트 목록으로</a></p></div> : <p role="status">프로젝트를 불러오는 중…</p>}</section>;
  return <><div inert={deleting ? true : undefined}><div className="page-heading"><div><a href="/projects" className="text-link">← 내 프로젝트</a><h1>{project.name}</h1><p className="muted">문서의 후보를 검토하고, 내 프로젝트의 정보를 확인해 주세요.</p></div><button className="secondary danger-text" onClick={() => setDeleting(true)}>삭제</button></div>
    {error && <div role="alert" className="error">{error}</div>}
    {attempt && <AnalysisStatus attempt={attempt} onCancel={async () => { setAttempt(await apiClient.cancel(id, attempt.id)); }} />}
    <div className="workspace-grid"><DocumentInput disabled={active} onText={async (text, provider) => { setAttempt(await apiClient.analyze(id, { kind: 'text', text }, provider)); }} onFile={async (file, provider) => { setAttempt(await apiClient.analyzeFile(id, file, provider)); }} />
    <ProfileEditor key={id} project={project} onSave={patch => apiClient.saveProfile(id, patch)} onSaved={setProject} onReload={async () => { const value = await apiClient.project(id); setProject(value); return value; }} /></div>
    <RecommendationPanel project={project}>{({ recommendation, selectedIds }) => <ConfigurationPanel key={`${recommendation.id}-${selectedIds.slice().sort().join(',')}`} projectId={project.id} recommendation={recommendation} selectedIds={selectedIds} />}</RecommendationPanel>
  </div>{deleting && <DeleteProjectDialog name={project.name} onCancel={() => setDeleting(false)} onDelete={async () => { await apiClient.deleteProject(id); window.location.assign('/projects'); }} />}</>;
}
