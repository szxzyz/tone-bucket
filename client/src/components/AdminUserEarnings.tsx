import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

type Category = 'all' | 'ads' | 'missions' | 'friends';
interface EarningItem {
  id: number;
  amount: string | number;
  source: string;
  description?: string | null;
  currency?: string | null;
  createdAt: string;
}

const categories: Array<{ id: Category; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'ads', label: 'Ads' }, { id: 'missions', label: 'Missions' }, { id: 'friends', label: 'Friends' },
];
const missionSources = new Set(['mission_ad', 'task_completion', 'daily_task_completion', 'task_share', 'task_channel', 'task_community', 'task_claim', 'gigapub_short_link', 'mission_daily_checkin', 'mission_share_story', 'mission_share_referral', 'mission_check_for_updates']);

function currencyName(value?: string | null) {
  const currency = String(value || 'GEM').toUpperCase();
  return currency === 'GOLD' || currency === 'GEMS' ? 'GEM' : currency;
}

export default function AdminUserEarnings({ userId }: { userId: string }) {
  const [category, setCategory] = useState<Category>('all');
  const { data, isLoading, isError } = useQuery<{ earnings: EarningItem[]; total: number }>({
    queryKey: ['/api/admin/user-earnings', userId],
    queryFn: () => apiRequest('GET', `/api/admin/user-earnings/${userId}?limit=1000`).then((response) => response.json()),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 30000,
  });
  const rows = (data?.earnings || []).filter((earning) => {
    if (category === 'all') return true;
    if (category === 'ads') return earning.source === 'ad_watch';
    if (category === 'friends') return earning.source === 'referral' || earning.source === 'referral_commission';
    return missionSources.has(earning.source);
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.04] p-1">
        {categories.map((item) => <button key={item.id} type="button" onClick={() => setCategory(item.id)} className={`rounded-lg px-1 py-2 text-[11px] font-bold ${category === item.id ? 'bg-blue-600 text-white' : 'text-white/50'}`}>{item.label}</button>)}
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading earnings…</p>
        : isError ? <p className="py-8 text-center text-sm text-red-300">Could not load earning history.</p>
          : rows.length === 0 ? <div className="py-8 text-center"><p className="text-white font-bold">Nothing here yet.</p><p className="text-xs text-muted-foreground mt-1">Earnings will show up here once you have some.</p></div>
            : <>
              <p className="text-xs text-muted-foreground">{rows.length}{data?.total && data.total > rows.length ? ` of ${data.total}` : ''} earning records</p>
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {rows.map((item) => <article key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white break-words">{item.description?.trim() || item.source.replaceAll('_', ' ')}</p>
                      <p className="text-[10px] text-white/45 mt-1">{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-emerald-300 tabular-nums">+{Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} {currencyName(item.currency)}</p>
                  </div>
                </article>)}
              </div>
            </>}
    </div>
  );
}
