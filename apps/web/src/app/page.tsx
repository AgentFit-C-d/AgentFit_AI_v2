import Link from 'next/link';
export default function Home() {
  return <><section className="hero"><p className="eyebrow">내 프로젝트에서 출발하는 AI 개발환경</p><h1>기획서를,<br /><span>실행할 준비로.</span></h1><p className="hero-copy">문서 속 기술과 기능을 정리하고, 미정인 부분은 직접 확인하세요. 프로젝트에 맞는 Codex 환경을 준비하는 첫 단계입니다.</p><Link className="button" href="/projects">내 프로젝트 시작하기 →</Link><p className="muted">GitHub 로그인 · 저장소 접근 권한을 요청하지 않습니다.</p></section><section className="steps" aria-label="시작 방법"><article><span>01</span><h2>프로젝트 만들기</h2><p>프로젝트 이름을 입력합니다. 기획서가 없어도 시작할 수 있습니다.</p></article><article><span>02</span><h2>문서 분석 또는 직접 작성</h2><p>PDF·Markdown·텍스트에서 정보를 정리합니다. 모르는 값은 미정으로 남깁니다.</p></article><article><span>03</span><h2>확인하고 저장</h2><p>AI 후보를 검토하고 수정합니다. 다시 접속해도 확인한 결과를 이어갑니다.</p></article></section></>;
}
