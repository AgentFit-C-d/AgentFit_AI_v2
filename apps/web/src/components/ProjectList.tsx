'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProjectDto } from '@agentfit/contracts';
import { apiClient } from '../lib/api';
import { errorMessage } from '../lib/errors';
export function ProjectList() {
  const [projects, setProjects] = useState<ProjectDto[]>([]); const [name, setName] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let alive = true; void apiClient.listProjects().then(result => { if (alive) setProjects(current => [...current, ...result.filter(project => !current.some(saved => saved.id === project.id))]); }).catch(failure => { if (alive) setError(errorMessage(failure)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, []);
  return <><section className="panel"><h2>새 프로젝트</h2><form className="create-project" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const created = await apiClient.createProject(name); setProjects(current => [created, ...current]); setName(''); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}><label>프로젝트 이름<input value={name} onChange={event => setName(event.target.value)} required autoComplete="off" disabled={busy} /></label><button disabled={busy || !name.trim()}>{busy ? '만드는 중…' : '프로젝트 만들기'}</button></form></section>
    {error && <div className="error" role="alert">{error}<p><a href="/projects">목록 다시 조회</a> · 상단에서 다시 로그인할 수 있습니다.</p></div>}
    {loading ? <p role="status">프로젝트를 불러오는 중…</p> : <section aria-label="내 프로젝트 목록" className="project-grid">{projects.length ? projects.map(project => <Link className="project-card" key={project.id} href={`/projects/${project.id}`}><span className="badge">{project.confirmedProfile ? '확인 결과 저장됨' : '정보 입력 필요'}</span><h2>{project.name}</h2><p>{project.draft ? '분석 초안 있음' : '직접 입력하거나 문서를 분석하세요'}</p><span className="text-link">프로젝트 열기 →</span></Link>) : !error && <div className="panel empty"><h2>첫 프로젝트를 만들어 보세요</h2><p>기획서가 없어도 직접 작성하고, 미정인 정보는 나중에 보완할 수 있습니다.</p></div>}</section>}
  </>;
}
