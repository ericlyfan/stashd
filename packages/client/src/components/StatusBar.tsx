import { useEffect, useRef, useState } from 'react';
import { checkHealth } from '../api';

type Status = 'checking' | 'online' | 'offline';

const POLL_MS = 15_000;

// Live server-connection indicator for the sidebar footer. Heartbeats the local
// server so you can tell at a glance whether the backend is up — the local-first
// promise, made observable. Its own component so the poll re-renders only this.
export default function StatusBar() {
  const [status, setStatus] = useState<Status>('checking');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const ping = async () => {
      const ok = await checkHealth();
      if (mounted.current) setStatus(ok ? 'online' : 'offline');
    };
    ping();
    const id = setInterval(ping, POLL_MS);
    // Re-check immediately when the tab regains focus (server may have restarted).
    const onFocus = () => ping();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const label =
    status === 'online' ? 'Local server · live' : status === 'offline' ? 'Local server · offline' : 'Local server · …';

  return (
    <div className={`side-status side-status-${status}`} title="Everything stays on this machine. This shows whether the local server is running.">
      <span className="side-status-dot" />
      <span className="side-status-label">{label}</span>
    </div>
  );
}
