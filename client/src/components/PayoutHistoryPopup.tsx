import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';

type Props = { open: boolean; onClose: () => void };
const CURRENCIES = ['TON', 'LTC', 'PEPE', 'DGB'] as const;

export default function PayoutHistoryPopup({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState<string>('TON');
  const [address, setAddress] = useState('');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const { data: rates } = useQuery<any>({ queryKey: ['/api/payout/rates'], enabled: open, retry: false, staleTime: 60000 });
  const { data: history } = useQuery<any>({ queryKey: ['/api/withdrawals'], enabled: open, retry: false });

  useEffect(() => {
    if (user?.payoutCurrency) setCurrency(user.payoutCurrency);
    if (user?.payoutWalletAddress) setAddress(user.payoutWalletAddress);
  }, [user]);

  const saveWallet = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/wallet/payout', { currency, address })).json(),
    onSuccess: (result) => { if (!result.success) throw new Error(result.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); showNotification('Wallet saved successfully', 'success'); },
    onError: (error: any) => showNotification(error.message || 'Could not save wallet', 'error'),
  });
  const payout = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/payouts', {})).json(),
    onSuccess: (result) => { if (!result.success) throw new Error(result.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] }); showNotification('Payout request sent for admin approval', 'success'); },
    onError: (error: any) => showNotification(error.message || 'Could not create payout', 'error'),
  });
  if (!open) return null;
  const saved = Boolean(user?.payoutWalletAddress);
  const rate = Number(rates?.rates?.[currency] || 0);
  const gold = Number(user?.balance || 0);
  const cryptoAmount = rate > 0 ? (gold / 100000) / rate : 0;
  const payouts = history?.withdrawals || history?.payouts || [];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <section onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 440, maxHeight: '86vh', overflowY: 'auto', background: '#171717', borderRadius: '22px 22px 0 0', padding: 18, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Wallet size={18} /> Set Wallet</div><button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: '#fff' }}><X size={20} /></button></div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>{CURRENCIES.map((item) => <button key={item} onClick={() => setCurrency(item)} style={{ flex: 1, height: 34, border: 0, borderRadius: 8, background: currency === item ? '#6b21a8' : 'rgba(255,255,255,0.07)', color: '#fff', fontWeight: 800, fontSize: 11 }}>{item}</button>)}</div>
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={`${currency} wallet/address`} style={{ width: '100%', height: 42, boxSizing: 'border-box', border: 0, borderRadius: 10, padding: '0 12px', background: '#000', color: '#fff', outline: 'none', marginBottom: 9 }} />
        <button onClick={() => saveWallet.mutate()} disabled={saveWallet.isPending || !address.trim()} style={{ width: '100%', height: 40, border: 0, borderRadius: 10, background: '#6b21a8', color: '#fff', fontWeight: 800 }}>{saveWallet.isPending ? 'Saving...' : saved ? 'Update Wallet' : 'Save Wallet'}</button>
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', fontSize: 12, lineHeight: 1.6 }}><div style={{ fontWeight: 800 }}>Exchange Rate</div><div>100,000 Gold = $1 USD</div><div>1 {currency} = ${rate ? rate.toFixed(6) : 'Loading...'}</div>{rate > 0 && <div>Current payout: {cryptoAmount.toFixed(8)} {currency}</div>}</div>
        <button onClick={() => payout.mutate()} disabled={!saved || payout.isPending || gold < 100000} style={{ width: '100%', height: 44, marginTop: 10, border: 0, borderRadius: 10, background: saved && gold >= 100000 ? '#22c55e' : 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 900 }}>{payout.isPending ? 'Submitting...' : 'Payout'}</button>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', margin: '18px 0 4px' }}>Payout History</div>
        {payouts.length === 0 ? <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', padding: '18px 0' }}>No payouts yet</div> : payouts.map((item: any) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 12 }}><span>{item.goldAmount || item.amount} {item.payoutCurrency || item.method}</span><span>{item.status}</span></div>)}
      </section>
    </div>
  );
}
