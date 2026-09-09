import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';

type Props = { open: boolean; onClose: () => void };

export default function PayoutHistoryPopup({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const { data } = useQuery<any>({ queryKey: ['/api/payout-history'], enabled: open, retry: false });
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const saveEmail = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/profile/faucetpay-email', { email })).json(),
    onSuccess: (result) => {
      if (!result.success) return showNotification(result.message || 'Could not save email', 'error');
      showNotification('FaucetPay email saved', 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: any) => showNotification(error.message || 'Could not save email', 'error'),
  });
  if (!open) return null;
  const payouts = data?.payouts || [];
  const currentEmail = user?.faucetpayEmail || '';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <section onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 440, maxHeight: '78vh', overflowY: 'auto', background: '#171717', borderRadius: '22px 22px 0 0', padding: 18, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Wallet size={18} /> Set Address</div>
          <button onClick={onClose} aria-label="Close payout history" style={{ background: 'none', border: 0, color: '#fff' }}><X size={20} /></button>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 7 }}>FaucetPay email</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={email || currentEmail} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" style={{ flex: 1, minWidth: 0, height: 38, border: 0, borderRadius: 9, padding: '0 10px', background: '#000', color: '#fff', outline: 'none' }} />
            <button onClick={() => saveEmail.mutate()} disabled={saveEmail.isPending} style={{ border: 0, borderRadius: 9, padding: '0 12px', background: '#6b21a8', color: '#fff', fontWeight: 800 }}>{saveEmail.isPending ? '...' : 'Save'}</button>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 7 }}>Mock payout mode is active; no real crypto is sent.</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', margin: '16px 0 4px' }}>Payout History</div>
        {payouts.length === 0 ? <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', padding: '24px 0' }}>No payouts yet</div> : payouts.map((payout: any) => (
          <div key={payout.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div><div style={{ fontWeight: 800 }}>{payout.amount} {payout.currency}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{payout.source}</div></div>
            <div style={{ textAlign: 'right', fontSize: 11, color: payout.status === 'mock_success' ? '#4ade80' : '#fbbf24' }}>{payout.status}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
