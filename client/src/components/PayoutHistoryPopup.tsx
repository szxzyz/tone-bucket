import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';

type Props = { open: boolean; onClose: () => void };

export default function PayoutHistoryPopup({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const [axnAmount, setAxnAmount] = useState('1000');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], enabled: open, retry: false, staleTime: 60000 });
  const { data: history } = useQuery<any>({ queryKey: ['/api/withdrawals'], enabled: open, retry: false });

  useEffect(() => {
    if (user?.payoutCurrency === 'AXN' && user?.payoutWalletAddress) setAddress(user.payoutWalletAddress);
  }, [user]);

  const minimumAxn = Math.max(1, Math.floor(Number(appSettings?.minimumCashoutGold || 1000)));
  const feePercent = Math.max(0, Math.min(100, Number(appSettings?.withdrawalFeeTON ?? 9)));
  useEffect(() => {
    if (axnAmount === '1000' && minimumAxn !== 1000) setAxnAmount(String(minimumAxn));
  }, [minimumAxn, axnAmount]);

  const saveWallet = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/wallet/payout', { currency: 'AXN', address })).json(),
    onSuccess: (result) => { if (!result.success) throw new Error(result.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); showNotification('AXN payout address saved successfully', 'success'); },
    onError: (error: any) => showNotification(error.message || 'Could not save AXN payout address', 'error'),
  });
  const withdrawal = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/payouts', { axnAmount: Number(axnAmount), address: address.trim() })).json(),
    onSuccess: (result) => { if (!result.success) throw new Error(result.message); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] }); showNotification('AXN withdrawal request sent to admin', 'success'); },
    onError: (error: any) => showNotification(error.message || 'Could not create AXN withdrawal request', 'error'),
  });

  if (!open) return null;
  const saved = user?.payoutCurrency === 'AXN' && Boolean(user?.payoutWalletAddress);
  const availableAxn = Math.max(0, Math.floor(Number(user?.balance || 0)));
  const selectedAxn = Number(axnAmount || 0);
  const feeAxn = selectedAxn * feePercent / 100;
  const netAxn = selectedAxn - feeAxn;
  const canWithdraw = Boolean(address.trim()) && selectedAxn >= minimumAxn && selectedAxn <= availableAxn && Number.isSafeInteger(selectedAxn);
  const payouts = history?.withdrawals || history?.payouts || [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'calc(68px + env(safe-area-inset-bottom))' }}>
      <section onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 440, maxHeight: 'calc(100vh - 92px)', overflowY: 'auto', background: '#171717', borderRadius: '22px 22px 0 0', padding: '18px 18px 28px', color: '#fff', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Wallet size={18} /> AXN Withdrawal</div><button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: '#fff' }}><X size={20} /></button></div>
        <div style={{ padding: 11, borderRadius: 10, background: 'rgba(255,255,255,0.05)', fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>Save your AXN payout address, then submit a request. An admin reviews the request and sends AXN manually after approval.</div>
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Enter your AXN payout address" style={{ width: '100%', height: 42, boxSizing: 'border-box', border: 0, borderRadius: 10, padding: '0 12px', background: '#000', color: '#fff', outline: 'none', marginBottom: 9 }} />
        <button onClick={() => saveWallet.mutate()} disabled={saveWallet.isPending || !address.trim()} style={{ width: '100%', height: 40, border: 0, borderRadius: 10, background: '#6b21a8', color: '#fff', fontWeight: 800 }}>{saveWallet.isPending ? 'Saving...' : saved ? 'Update AXN Address' : 'Save AXN Address'}</button>
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 800, marginBottom: 3 }}>Withdrawal amount</div>
          <div style={{ color: 'rgba(255,255,255,0.65)', marginBottom: 7 }}>Available: {availableAxn.toLocaleString()} AXN</div>
          <input inputMode="numeric" value={axnAmount} onChange={(event) => setAxnAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder={`Enter AXN amount (minimum ${minimumAxn.toLocaleString()})`} style={{ width: '100%', height: 40, boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0 10px', background: '#000', color: '#fff', outline: 'none' }} />
          <div style={{ marginTop: 8 }}>Minimum: {minimumAxn.toLocaleString()} AXN</div>
          <div>Fee: {feePercent}% ({feeAxn.toLocaleString(undefined, { maximumFractionDigits: 8 })} AXN)</div>
          <div>You receive: {netAxn.toLocaleString(undefined, { maximumFractionDigits: 8 })} AXN</div>
        </div>
        <button onClick={() => withdrawal.mutate()} disabled={!canWithdraw || withdrawal.isPending} style={{ width: '100%', height: 44, marginTop: 10, border: 0, borderRadius: 10, background: canWithdraw ? '#22c55e' : 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 900 }}>{withdrawal.isPending ? 'Submitting...' : 'Request AXN Withdrawal'}</button>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', margin: '18px 0 4px' }}>Withdrawal History</div>
        {payouts.length === 0 ? <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', padding: '18px 0' }}>No withdrawals yet</div> : payouts.map((item: any) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 12 }}><span>{item.goldAmount || item.details?.axnAmount || item.amount} AXN</span><span>{item.status}</span></div>)}
      </section>
    </div>
  );
}
