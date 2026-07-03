import { useEffect, useState } from 'react';

// A live, ticking day/date/time readout for the sidebar. Kept as its own
// component so the per-second state update re-renders only the clock, not the
// whole sidebar (and its drawer list).
export default function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const date = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="side-clock" role="timer" aria-label="Current date and time">
      <time className="side-clock-time">{time}</time>
      <div className="side-clock-date">
        {day} · {date}
      </div>
    </div>
  );
}
