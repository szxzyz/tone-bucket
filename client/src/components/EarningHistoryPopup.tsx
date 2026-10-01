import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Sparkles } from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

type Category = 'all' | 'ads' | 'missions' | 'friends';
interface EarningItem {
  id: number;
  amount: string | number;
  source: string;
  description?: string | null;
  currency?: string | null;
  createdAt: string;
  friendName?: string | null;
  friendUsername?: string | null;
}
interface HistoryResponse {
  earnings: EarningItem[];
  page: number;
  totalPages: number;
  total: number;
}

const PAGE_SIZE = 20;
const TABS: Array<{ id: Category; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ads', label: 'Ads' },
  { id: 'missions', label: 'Missions' },
  { id: 'friends', label: 'Friends' },
];

function readableSource(source: string) {
  return source.split('_').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') || 'Earning';
}

function formatAmount(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 8 }) : String(value);
}

function displayCurrency(value?: string | null) {
  const currency = String(value || 'GEM').toUpperCase();
  if (currency === 'GOLD' || currency === 'GEMS') return 'GEM';
  return currency;
}

function displayTitle(item: EarningItem) {
  if (item.friendName) return item.source === 'referral_commission' ? `Commission from ${item.friendName}` : `Referral reward — ${item.friendName}`;
  if (item.description?.trim()) return item.description.trim();
  const labels: Record<string, string> = {
    ad_watch: 'Ad watched',
    mission_ad: 'Mission ad reward',
    task_completion: 'Task completed',
    referral: 'Friend referral reward',
    referral_commission: 'Friend commission',
  };
  return labels[item.source] || readableSource(item.source);
}

export default function EarningHistoryPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category>('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery<HistoryResponse>({
    queryKey: ['/api/earnings', 'history', category, page],
    queryFn: async () => {
      const params = new URLSearchParams({ category, page: String(page), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/earnings?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load earning history');
      return response.json();
    },
    enabled: open,
    retry: false,
    staleTime: 30000,
  });

  const selectCategory = (next: Category) => {
    setCategory(next);
    setPage(1);
  };

  return (
    <Drawer open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DrawerContent className="max-h-[86dvh] border-white/10 bg-[#111] text-white">
        <DrawerHeader className="flex items-center justify-between pb-2">
          <div>
            <DrawerTitle className="text-left text-white font-bold text-lg">Earning History</DrawerTitle>
            <p className="text-left text-white/40 text-xs mt-1">Your credited rewards, with names and dates</p>
          </div>
          <DrawerClose asChild><button className="px-3 py-1 rounded-lg text-white/55 hover:text-white hover:bg-white/10 text-sm">Close</button></DrawerClose>
        </DrawerHeader>

        <div className="px-4 pb-6 overflow-y-auto">
          <div role="tablist" aria-label="Filter earning history" className="grid grid-cols-4 gap-1 p-1 rounded-xl mb-3 bg-white/[0.04]">
            {TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={category === tab.id} onClick={() => selectCategory(tab.id)} className={`rounded-lg py-2 px-1 text-[11px] font-bold transition-colors ${category === tab.id ? 'bg-blue-600 text-white' : 'text-white/45 hover:text-white/80'}`}>{tab.label}</button>)}
          </div>

          {isLoading ? <div className="py-12 text-center text-sm text-white/45">Loading earnings…</div>
            : isError ? <div className="py-12 text-center text-sm text-rose-300">Could not load your earnings. Please try again.</div>
              : !data?.earnings?.length ? <div className="py-12 text-center">
                <Sparkles className="w-8 h-8 text-white/20 mx-auto mb-3" />
                <p className="text-white font-bold text-sm">Nothing here yet.</p>
                <p className="text-white/45 text-xs mt-1">Earnings will show up here once you have some.</p>
              </div> : <div className="space-y-2">
                {data.earnings.map((item) => (
                  <article key={item.id} className="rounded-xl p-3 bg-[linear-gradient(145deg,#1a1c20_0%,#121317_100%)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-bold text-sm leading-5 break-words">{displayTitle(item)}</p>
                        {item.friendUsername && <p className="text-white/40 text-[11px] mt-0.5">@{item.friendUsername.replace(/^@/, '')}</p>}
                        <p className="flex items-center gap-1 text-white/40 text-[10px] mt-1.5"><CalendarDays className="w-3 h-3" />{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-emerald-300 font-black text-sm tabular-nums">+{formatAmount(item.amount)} {displayCurrency(item.currency)}</p>
                        <p className="text-white/30 text-[9px] mt-1 uppercase tracking-wide">{readableSource(item.source)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>}

          {!isLoading && !isError && !!data?.total && <div className="flex items-center justify-between gap-3 pt-4">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-30"><ChevronLeft className="w-4 h-4" />Previous</button>
            <span className="inline-flex items-center gap-1 text-white/40 text-xs tabular-nums"><Clock3 className="w-3 h-3" />{page} / {Math.max(1, data.totalPages)} · {data.total} records</span>
            <button type="button" onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))} disabled={page >= data.totalPages} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-30">Next<ChevronRight className="w-4 h-4" /></button>
          </div>}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
