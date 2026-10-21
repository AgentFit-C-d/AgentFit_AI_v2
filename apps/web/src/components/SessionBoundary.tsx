'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { subscribeSessionEnded } from '../lib/session-lifetime';
export function SessionBoundary({ children }: { children: ReactNode }) {
  const [ended, setEnded] = useState(false);
  useEffect(() => subscribeSessionEnded(() => setEnded(true)), []);
  return ended ? <section className="panel" role="status"><p>로그인이 종료되었습니다. 입력과 미리보기를 닫았습니다.</p><a href="/projects">다시 로그인하기</a></section> : children;
}
