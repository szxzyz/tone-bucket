import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Gift, Loader2 } from 'lucide-react';
import { showNotification } from '@/components/AppNotification';

const LINKS = [
  'https://link.gigapub.tech/l/c8hd9h0d7',
  'https://link.gigapub.tech/l/9ttyplb0va',
  'https://link.gigapub.tech/l/vkcp91if6',
] as const;
const REWARD = 20;
type Step = 'idle' | 'waiting' | 'ready' | 'claiming' | 'completed';

function openExternalLink(url: string) {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export default function GigapubShortLinkTasks() {
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<Step[]>(['idle', 'idle', 'idle']);
  const [startedAt, setStartedAt] = useState<number[]>([0, 0, 0]);
  const [returnedFromLink, setReturnedFromLink] = useState<boolean[]>([false, false, false]);

  const { data: taskStatus } = useQuery<{ completedTasks?: string[] }>({
    queryKey: ['/api/tasks/daily/status'],
    retry: false,
  });

  const completed = useMemo(() => new Set(taskStatus?.completedTasks || []), [taskStatus]);

  useEffect(() => {
    setSteps((current) => current.map((step, index) =>
      completed.has(`gigapub-short-link-${index + 1}`) ? 'completed' : step,
    ));
  }, [completed]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      setReturnedFromLink((current) => current.map((returned, index) =>
        steps[index] === 'waiting' && startedAt[index] > 0 ? true : returned,
      ));
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [startedAt, steps]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSteps((current) => current.map((step, index) => {
        if (step !== 'waiting' || !startedAt[index]) return step;
        const elapsed = Date.now() - startedAt[index];
        return elapsed >= 3_000 && (returnedFromLink[index] || document.visibilityState === 'visible') ? 'ready' : step;
      }));
    }, 250);
    return () => window.clearInterval(timer);
  }, [returnedFromLink, startedAt]);

  const updateTask = (index: number, patch: Partial<{ step: Step; startedAt: number; returned: boolean }>) => {
    if (patch.step) setSteps((current) => current.map((value, i) => i === index ? patch.step! : value));
    if (patch.startedAt !== undefined) setStartedAt((current) => current.map((value, i) => i === index ? patch.startedAt! : value));
    if (patch.returned !== undefined) setReturnedFromLink((current) => current.map((value, i) => i === index ? patch.returned! : value));
  };

  const startTask = async (index: number) => {
    if (steps[index] !== 'idle') return;
    const response = await fetch('/api/tasks/gigapub-short-link/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ taskId: index + 1 }),
    });
    const data = await response.json();
    if (!response.ok) {
      showNotification(data.message || 'Unable to start task', 'error');
      return;
    }
    updateTask(index, { step: 'waiting', startedAt: Date.now(), returned: false });
    openExternalLink(data.url || LINKS[index]);
  };

  const claimTask = async (index: number) => {
    if (steps[index] !== 'ready') return;
    updateTask(index, { step: 'claiming' });
    try {
      const response = await fetch('/api/tasks/gigapub-short-link/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskId: index + 1 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to claim reward');
      updateTask(index, { step: 'completed' });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/daily/status'] });
      showNotification(`+${REWARD} Gold earned!`, 'success');
    } catch (error: any) {
      updateTask(index, { step: 'ready' });
      showNotification(error.message || 'Unable to claim reward', 'error');
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Gift className="w-4 h-4 text-[#f59e0b]" />
        <h2 className="text-white text-sm font-bold">Sponsored by Gigapub</h2>
      </div>
      {LINKS.map((_, index) => {
        const step = completed.has(`gigapub-short-link-${index + 1}`) ? 'completed' : steps[index];
        const isWaiting = step === 'waiting';
        const isReady = step === 'ready';
        return (
          <div key={index} className="minimal-card rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
              <ExternalLink className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-semibold">Gigapub Short Link {index + 1}</div>
              <div className="text-white/45 text-xs mt-1">Visit for 3 seconds · +{REWARD} Gold</div>
            </div>
            <button
              type="button"
              disabled={step === 'completed' || step === 'claiming' || isWaiting}
              onClick={() => isReady ? claimTask(index) : startTask(index)}
              className={`shrink-0 min-w-[76px] h-9 rounded-lg px-3 text-xs font-bold text-white flex items-center justify-center gap-1 ${step === 'completed' ? 'bg-emerald-600' : isReady ? 'bg-emerald-500' : isWaiting ? 'bg-gray-600' : 'bg-gradient-to-r from-[#3d1580] to-[#6b21a8]'}`}
            >
              {step === 'completed' ? <><Check className="w-3 h-3" />Done</> : step === 'claiming' ? <Loader2 className="w-4 h-4 animate-spin" /> : isWaiting ? '3s…' : isReady ? 'Claim' : 'Visit'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
