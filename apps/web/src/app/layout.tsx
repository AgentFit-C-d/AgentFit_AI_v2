import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '../components/AuthPanel';
import './globals.css';
export const metadata: Metadata = { title: 'AgentFit · 프로젝트에 맞는 AI 개발환경', description: '기획서에서 프로젝트 정보를 확인하고 나에게 맞는 AI 개발환경을 준비하세요.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body><a className="skip-link" href="#main">본문으로 이동</a><header className="site-header"><Link className="brand" href="/">Agent<span>Fit</span></Link><nav aria-label="주요 메뉴"><Link href="/projects">내 프로젝트</Link></nav><AuthPanel /></header><main id="main">{children}</main><footer>AgentFit · AI 초안은 사용자의 확인 후 저장됩니다.</footer></body></html>;
}
