import { assertNoSecrets, skillLibrary, type PreviewFile, type PreviewInput } from '@agentfit/contracts';
import type { ValidatedSelection } from './permissions';
import { staticSnapshots } from '../skills/static-snapshots';
import { sha256 } from './hash';
import { managed, mergeManaged } from './merge';
import { createTwoFilesPatch } from 'diff';
import { AppError } from '../http/errors';
const guide = `# Codex 적용 안내\n\n1. Preview의 파일 경로와 내용을 확인하세요. 기존 파일을 제공하지 않은 경로는 신규 설정안입니다. 실제 PC의 기존 내용을 확인하고 백업한 뒤 필요한 파일만 프로젝트 폴더에 복사하세요. 폴더 전체를 덮어쓰지 마세요.\n2. .agents/skills 아래 Skill은 자연어 지침입니다. 실행 권한을 강제하거나 Secret을 저장하는 장치가 아닙니다. 이번 구성에는 외부 MCP 연결이나 자동 실행이 없습니다.\n3. Codex에서 해당 프로젝트를 열고 Skill이 발견되는지 확인하세요. 대표적인 무해한 확인은 선택한 Skill의 이름을 언급하며 작은 코드 검토를 요청하는 것입니다. 실제 파일 쓰기·외부 연결·인증은 별도 확인하세요.\n4. 적용 결과가 잘못되면 복사 전에 만든 백업으로 해당 파일만 복원하세요. 인증 오류·의존성 부족·복사 실패는 생성 이력에 사용자 진술로 남길 수 있습니다.\n5. 환경은 사용자 입력 기준입니다. 생성·다운로드는 설치·인증·연결·검증을 뜻하지 않습니다. 상위 정책과 실제 권한은 미검증입니다. 대표 검사 기록: Windows11 / desktop26.930.4958.0 / engine0.160.0. 이는 검사 당시의 환경이며 필수 앱 버전이 아닙니다. 자연어 Skill 추천에는 앱 버전 입력·일치 검사를 사용하지 않습니다.\n`;
export function generateFiles(selection: ValidatedSelection, input: PreviewInput): PreviewFile[] {
  const libraries = new Map<string, { library: NonNullable<ReturnType<typeof skillLibrary>>; items: ValidatedSelection['items'] }>();
  const snapshots = [...staticSnapshots, ...(selection.snapshots ?? []).map(p => ({ ...p, id: `discovered-${p.hash}` }))];
  const drafts: { targetKey: string; relativePath: string; content: string }[] = [];
  const names = new Set<string>();
  for (const item of selection.items) {
    if (item.kind !== 'SKILL' || item.permissionOptions.length) throw new AppError('UNSUPPORTED_CONFIGURATION', 422);
    const library = skillLibrary(item.skillsUrl);
    if (library && library.repository !== item.repository.toLowerCase()) throw new AppError('INVALID_SNAPSHOT', 422);
    if (library) {
      const entry = libraries.get(library.repository) ?? { library, items: [] };
      entry.items.push(item); libraries.set(library.repository, entry);
    }
    const snapshot = snapshots.find(x => x.id === item.id);
    if (!snapshot || snapshot.commit !== item.commit) throw new AppError('SNAPSHOT_NOT_AVAILABLE', 422);
    if (!library) {
      if (names.has(snapshot.name)) throw new AppError('SELECTION_CONFLICT', 422);
      names.add(snapshot.name);
    }
    for (const file of snapshot.files) {
      if (sha256(file.content) !== file.sha256 || !/^[A-Za-z0-9_.\/-]+\.(?:md|txt)$/.test(file.path) || file.path.split('/').some(x => x === '..')) throw new AppError('INVALID_SNAPSHOT', 422);
      if (!library) drafts.push({ targetKey: item.id, relativePath: `.agents/skills/${snapshot.name}/${file.path}`, content: managed(file.content, item.id) });
    }
  }
  if (input.customSkill) {
    const { name, description, instructions } = input.customSkill;
    if (names.has(name)) throw new AppError('SELECTION_CONFLICT', 422);
    drafts.push({ targetKey: 'custom-skill', relativePath: `.agents/skills/${name}/SKILL.md`, content: managed(`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${instructions}\n`, 'custom-skill') });
  }
  const libraryEntries = [...libraries.values()].sort((a, b) => a.library.repository.localeCompare(b.library.repository));
  const librarySources = libraryEntries.map(({ library, items }) => `- ${library.name}: ${library.url}\n  공식 설치 안내: ${library.installationUrl}\n  추천 근거 commit: ${[...new Set(items.map(item => item.commit))].sort().join(', ')}\n  근거 스킬 라이선스: ${[...new Set(items.map(item => item.license))].sort().join(', ')}. 라이브러리 전체의 라이선스·설치 범위는 공식 문서에서 확인하세요.\n`).join('\n');
  const individualSources = selection.items.filter(item => !skillLibrary(item.skillsUrl)).map(item => `- ${item.name}: ${item.skillsUrl}\n  Repository: ${item.repository} / commit: ${item.commit}\n  License: ${item.license}\n`).join('\n');
  const sources = '# 선택한 라이브러리·Skill 출처\n\n' + librarySources + individualSources + '\n추천 근거의 고정 commit은 설치 버전을 보장하지 않습니다. 공식 문서의 최신 설치 경로·버전·권한·라이선스를 확인하세요. 라이브러리 개별 스킬 파일과 Plugin·Hook·실행 스크립트는 이 ZIP에 포함하지 않습니다.\n';
  const libraryGuide = '# 라이브러리 공식 설치 안내\n\n선택한 라이브러리의 공식 문서를 확인하고 직접 설치하세요. 이 ZIP에는 라이브러리의 개별 스킬 파일이 없습니다.\n\n' + libraryEntries.map(({ library, items }) => `## ${library.name}\n\n${library.description}\n\n추천 이유: ${[...new Set(items.map(item => selection.recommendation.items.find(recommended => recommended.catalogItemId === item.id)?.reason ?? '프로젝트 업무 지원'))].join(' ')}\n\n공식 설치 안내: ${library.installationUrl}\n\n${library.installationHint}\n\n`).join('') + '1. 각 공식 설치 안내에서 Codex에 맞는 설치 방법을 확인하세요.\n2. 설치할 버전·프로젝트 또는 전역 적용 범위·요구 권한·Hook·스크립트·의존성을 검토한 뒤 설치하세요. AgentFit은 공식 설치를 대신 실행하거나 권한을 승인하지 않습니다.\n3. 설치 후 공식 안내에 따라 세션을 다시 열고 라이브러리가 인식되는지 작은 작업으로 확인하세요. 다운로드는 설치·연결·사용 검증을 뜻하지 않습니다.\n4. 문제가 있으면 공식 제거 안내로 설치한 라이브러리를 해제하세요. 기존 설치가 있다면 공식 업데이트·제거 절차를 먼저 확인하세요. 이 ZIP은 기존 개별 Skill 파일을 삭제하거나 덮어쓰지 않습니다.\n5. 내 작업 규칙을 추가했다면 .agents/skills의 해당 파일만 내용을 확인하고 기존 파일을 백업한 뒤 복사하세요.\n\n추천 근거는 개별 스킬의 검사 범위입니다. 라이브러리 전체·공식 설치 결과·최신 버전은 미검증입니다. AGENTFIT-SOURCES.md의 commit은 추천 근거이며 설치 버전을 고정하지 않습니다.\n';
  const dynamicNotice = selection.items.some(x => x.package) ? '\n새로 탐색한 추천 근거는 출처·고정 commit·라이선스·파일 패키지만 검사했습니다. 이 검사를 라이브러리 전체·최신 버전·실제 Codex 설치·사용 검증으로 확대하지 않습니다.\n' : '';
  drafts.push({ targetKey: 'guide', relativePath: 'AGENTFIT-APPLY.md', content: managed((libraries.size ? libraryGuide : guide) + dynamicNotice, 'guide') }, { targetKey: 'sources', relativePath: 'AGENTFIT-SOURCES.md', content: managed(sources, 'sources') });
  const paths = new Set<string>();
  for (const file of input.existingFiles) {
    if (paths.has(file.relativePath) || !drafts.some(x => x.relativePath === file.relativePath && x.targetKey === file.targetKey)) throw new AppError('UNSUPPORTED_TARGET', 422);
    paths.add(file.relativePath);
  }
  return drafts.sort((a, b) => a.relativePath < b.relativePath ? -1 : 1).map(file => {
    const original = input.existingFiles.find(x => x.relativePath === file.relativePath);
    const content = original ? mergeManaged(original.content, file.content, file.targetKey) : file.content;
    assertNoSecrets(content);
    const diff = original ? createTwoFilesPatch(file.relativePath, file.relativePath, original.content, content, '', '', { timeout: 1000, maxEditLength: 20000 }) : null;
    if (diff === undefined) throw new AppError('DIFF_TOO_COMPLEX', 422);
    return { ...file, content, afterHash: sha256(content), beforeHash: original ? sha256(original.content) : null, diff, action: original ? 'UPDATE' : 'PROPOSAL', comparisonScope: original ? 'PROVIDED_FILE' : 'EXISTING_UNKNOWN' };
  });
}
