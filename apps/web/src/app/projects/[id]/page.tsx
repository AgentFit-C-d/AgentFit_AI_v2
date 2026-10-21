import { ProjectWorkspace } from '../../../components/ProjectWorkspace';
import { SessionBoundary } from '../../../components/SessionBoundary';
export default async function Project({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SessionBoundary><ProjectWorkspace id={id} /></SessionBoundary>; }
