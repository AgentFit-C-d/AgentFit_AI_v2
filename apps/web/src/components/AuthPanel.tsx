'use client';
import { useEffect, useState } from 'react';
import type { SessionUser } from '@agentfit/contracts';
import { apiClient } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { errorMessage } from '../lib/errors';
import { notifySessionEnded, subscribeSessionEnded } from '../lib/session-lifetime';
export function AuthPanel() {
  const [user, setUser] = useState<SessionUser | null>(null); const [configured, setConfigured] = useState(false); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let authenticated = false; let checking = false; let ended = false;
    const unsubscribe = subscribeSessionEnded(() => { ended = true; authenticated = false; if (alive) setUser(null); });
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('agentfit-session');
    if (channel) channel.onmessage = event => { if (event.data === 'ENDED') notifySessionEnded(false); };
    const check = async () => {
      if (!authenticated || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try { const value = await apiClient.me(); if (alive && authenticated) setUser(value); }
      catch (failure) { if (alive && failure instanceof Error && failure.message === 'AUTH_REQUIRED') notifySessionEnded(); }
      finally { checking = false; }
    };
    void Promise.all([apiClient.me().catch(() => null), apiClient.runtime()]).then(([value, runtime]) => { if (alive) { if (!ended) { authenticated = value !== null; setUser(value); } setConfigured(runtime.githubConfigured); } }).catch(failure => { if (alive) setError(errorMessage(failure)); }).finally(() => { if (alive) setBusy(false); });
    const timer = setInterval(() => { void check(); }, 15000); const focus = () => { void check(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { alive = false; unsubscribe(); channel?.close(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, []);
  return <div className="auth-panel">{user ? <><span>{user.name} 님</span><button className="secondary" disabled={busy} onClick={async () => { setBusy(true); try { const result = await authClient.signOut(); if (result.error) throw new Error('REQUEST_FAILED'); notifySessionEnded(); window.location.assign('/'); } catch (failure) { setError(errorMessage(failure)); setBusy(false); } }}>로그아웃</button></> : <><button disabled={busy || !configured} onClick={async () => { setBusy(true); setError(''); try { const result = await authClient.signIn.social({ provider: 'github', callbackURL: '/projects' }); if (result.error) throw new Error('REQUEST_FAILED'); } catch (failure) { setError(errorMessage(failure)); setBusy(false); } }}>GitHub로 로그인</button>{!busy && !configured && <small>GitHub 로그인이 아직 준비되지 않았습니다.</small>}</>}{error && <p role="alert">{error}</p>}</div>;
}
