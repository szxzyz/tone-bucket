import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import Layout from '@/components/Layout';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery } from '@tanstack/react-query';

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function Ads() {
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const [timerActive, setTimerActive] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerStartedAtRef = useRef<number | null>(null);

  const startAdTimer = useCallback(() => {
    timerStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setTimerActive(true);
  }, []);

  const stopAdTimer = useCallback(() => {
    const startedAt = timerStartedAtRef.current;
    if (startedAt !== null) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    timerStartedAtRef.current = null;
    setTimerActive(false);
  }, []);

  useEffect(() => {
    if (!timerActive) return;
    const updateTimer = () => {
      const startedAt = timerStartedAtRef.current;
      if (startedAt !== null) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(interval);
  }, [timerActive]);

  const timerLabel = formatTime(elapsedSeconds);

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <section aria-labelledby="viewing-ads-title" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <h1 id="viewing-ads-title" style={{ margin: '0 0 3px', color: '#fff', fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>
              Viewing Ads
            </h1>
            <div
              role="timer"
              aria-label={`Ad watch timer ${timerLabel}`}
              aria-live="off"
              title="Ad watch timer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '6px 10px', borderRadius: 999,
                background: timerActive ? 'rgba(37,99,235,0.16)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${timerActive ? 'rgba(59,130,246,0.42)' : 'rgba(255,255,255,0.1)'}`,
                color: timerActive ? '#93c5fd' : 'rgba(255,255,255,0.62)',
                fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              }}
            >
              <Clock size={14} aria-hidden="true" />
              <span>{timerLabel}</span>
              {timerActive && <span style={{ fontSize: 9, letterSpacing: '0.08em' }}>LIVE</span>}
            </div>
          </div>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.4 }}>
            Get paid for watching short ads on Telegram.
          </p>
        </section>
        <AdWatchingSection user={user} hideTitle onWatchStart={startAdTimer} onWatchStop={stopAdTimer} />
      </main>
    </Layout>
  );
}
