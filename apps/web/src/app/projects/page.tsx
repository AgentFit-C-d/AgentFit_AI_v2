import { ProjectList } from '../../components/ProjectList';
import { SessionBoundary } from '../../components/SessionBoundary';
export default function Projects() { return <SessionBoundary><div className="page-heading"><div><p className="eyebrow">내 작업 공간</p><h1>프로젝트</h1><p className="muted">내가 확인한 정보를 저장하고 이어서 작업합니다.</p></div></div><ProjectList /></SessionBoundary>; }
