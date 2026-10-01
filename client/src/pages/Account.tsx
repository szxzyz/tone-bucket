import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleHelp, Languages, Settings, Wallet, CreditCard, List, ArrowDownToLine, Coins } from 'lucide-react';
import Layout from '@/components/Layout';
import PayoutHistoryPopup from '@/components/PayoutHistoryPopup';
import { showNotification } from '@/components/AppNotification';

const cardStyle: CSSProperties = { background: '#171717', borderRadius: 16, padding: 16 };

export default function Account() {
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'earnings' | 'withdraw'>('all');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: earnings = [], isLoading: earningsLoading } = useQuery<any[]>({ queryKey: ['/api/earnings', 50], queryFn: async () => { const res = await fetch('/api/earnings?limit=50', { credentials: 'include' }); return res.ok ? res.json() : []; }, retry: false });
  const { data: withdrawalData } = useQuery<any>({ queryKey: ['/api/withdrawals'], retry: false });
  const withdrawals = withdrawalData?.withdrawals || [];
  const rawGold = Number(user?.balance || 0);
  const gold = rawGold < 1 ? Math.round(rawGold * 10000000) : Math.round(rawGold);
  const allItems = [
    ...earnings.map((item: any) => ({ ...item, kind: 'earning', label: item.description || item.source || 'Earning', value: Number(item.amount || 0), date: item.createdAt })),
    ...withdrawals.map((item: any) => ({ ...item, kind: 'withdraw', label: 'TON withdrawal', value: -Number(item.goldAmount || item.details?.goldAmount || item.amount || 0), date: item.createdAt })),
  ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  const items = tab === 'all' ? allItems : allItems.filter((item) => item.kind === (tab === 'earnings' ? 'earning' : 'withdraw'));

  const more = (name: string) => {
    if (name === 'Track payment') { setTab('withdraw'); document.getElementById('transaction-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (name === 'Support') {
      const link = user?.supportBotLink || 'https://t.me/GrabPennySupportBot';
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank');
      return;
    }
    showNotification(`${name} will be available soon`, 'info');
  };

  return <Layout>
    <main className="max-w-md mx-auto px-4 text-white" style={{ paddingTop: 18, paddingBottom: 110 }}>
      <section style={{ ...cardStyle, background: 'linear-gradient(145deg, #2b1352, #171717)', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 700 }}>GOLD BALANCE</div><div style={{ fontSize: 28, fontWeight: 900, marginTop: 5 }}>{gold.toLocaleString()}</div></div><div style={{ width: 46, height: 46, borderRadius: 15, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Coins size={25} color="#facc15" /></div></div>
        <button onClick={() => setCashOutOpen(true)} style={{ width: '100%', height: 46, marginTop: 16, border: 0, borderRadius: 12, background: '#6b21a8', color: '#fff', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><ArrowDownToLine size={18} /> Withdraw your gold</button>
      </section>
      <section id="transaction-history" style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 900, marginBottom: 12 }}><CreditCard size={19} color="#c084fc" /> Transactions history</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, background: '#0d0d0d', padding: 4, borderRadius: 10, marginBottom: 12 }}>{(['all', 'earnings', 'withdraw'] as const).map((item) => <button key={item} onClick={() => setTab(item)} style={{ height: 34, border: 0, borderRadius: 8, background: tab === item ? '#6b21a8' : 'transparent', color: tab === item ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{item}</button>)}</div>
        {earningsLoading ? <div style={{ color: 'rgba(255,255,255,0.45)', padding: 15, textAlign: 'center' }}>Loading history...</div> : items.length === 0 ? <div style={{ color: 'rgba(255,255,255,0.45)', padding: 15, textAlign: 'center' }}>No transactions yet</div> : items.slice(0, 30).map((item: any) => <div key={`${item.kind}-${item.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div><div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 3 }}>{item.date ? new Date(item.date).toLocaleDateString() : ''} {item.kind === 'withdraw' ? `· ${item.status}` : ''}</div></div><div style={{ color: item.kind === 'withdraw' ? '#fb7185' : '#86efac', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}>{item.kind === 'withdraw' ? '-' : '+'}{Math.abs(item.value).toLocaleString()} GOLD</div></div>)}
      </section>
      <section style={cardStyle}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 900, marginBottom: 10 }}><List size={19} color="#c084fc" /> More</div>{[['Settings', Settings], ['Track payment', Wallet], ['Support', CircleHelp], ['Languages', Languages]].map(([name, Icon]: any) => <button key={name} onClick={() => more(name)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, height: 48, border: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', textAlign: 'left' }}><Icon size={18} color="rgba(255,255,255,0.65)" /><span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{name}</span><ChevronRight size={17} color="rgba(255,255,255,0.35)" /></button>)}</section>
      <PayoutHistoryPopup open={cashOutOpen} onClose={() => setCashOutOpen(false)} />
    </main>
  </Layout>;
}
