export interface SkillLibrary { repository: string; name: string; description: string; url: string; installationUrl: string; installationHint: string }
const names: Record<string, { name: string; description: string }> = {
  'obra/superpowers': { name: 'Superpowers', description: '구현 계획·TDD·디버깅·완료 검증으로 개발 과정을 돕습니다.' },
  'vercel-labs/agent-skills': { name: 'Vercel Agent Skills', description: 'React·Next.js 구현과 컴포넌트 설계를 돕습니다.' },
  'prisma/skills': { name: 'Prisma Skills', description: 'Prisma 데이터베이스 설정·쿼리·마이그레이션 작업을 돕습니다.' },
  'better-auth/skills': { name: 'Better Auth Skills', description: '인증 기능 구현과 보안 검토를 돕습니다.' },
};
/** Identify the source library, not a claim that every member has been verified. */
export function skillLibrary(source?: string): SkillLibrary | undefined {
  if (!source) return;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !['skills.sh', 'www.skills.sh'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return;
    const match = /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(url.pathname);
    if (!match) return;
    const repository = `${match[1]}/${match[2]}`.toLowerCase();
    const known = names[repository]; const repositoryUrl = `https://github.com/${repository}`;
    return { repository, name: known?.name ?? repository, description: known?.description ?? '프로젝트 기능·업무에 맞는 스킬을 제공하는 라이브러리입니다.', url: repositoryUrl, installationUrl: `${repositoryUrl}${repository === 'obra/superpowers' ? '#codex-app' : '#readme'}`, installationHint: repository === 'obra/superpowers' ? 'Codex 앱의 Plugins에서 Superpowers를 검색하고 공식 안내에 따라 설치하세요.' : '공식 README의 설치 절차에서 Codex 지원·설치 범위·버전을 확인하고 진행하세요.' };
  } catch { return; }
}
