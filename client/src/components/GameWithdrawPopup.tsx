import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';
import { getTONPrice } from '@/lib/tonPriceService';

type Props = { open: boolean; onClose: () => void; userBalance: number };

export default function GameWithdrawPopup({ open, onClose, userBalance }: Props) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [tonPrice, setTonPrice] = useState(0);
  const connectedAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const { data: settings } = useQuery<any>({ queryKey: ['/api/app-settings'], enabled: open, retry: false, staleTime: 60000 });

  useEffect(() => {
    if (!open) return;
    getTONPrice().then(setTonPrice).catch(() => {});
  }, [open]);

  const savedAddress = user?.payoutWalletAddress || '';
  const address = connectedAddress || savedAddress;
  const saved = Boolean(savedAddress);
  const minimum = Math.max(1, Number(settings?.minimumCashoutGold || 1000));
  const feePercent = 9;
  const secondaryAccountBlocked = Boolean(user?.secondaryAccountBlocked);

  const saveWallet = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/wallet/payout', { currency: 'TON', address: address.trim() })).json(),
    onSuccess: (data) => {
      if (!data.success) throw new Error(data.message);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification('TON address saved successfully', 'success');
    },
    onError: (error: any) => showNotification(error.message || 'Could not save TON address', 'error'),
  });

  const withdrawal = useMutation({
    mutationFn: async () => {
      // Persist a newly connected wallet before submitting the Swag Bux GEM payout.
      if (connectedAddress && !saved) {
        const response = await apiRequest('PATCH', '/api/wallet/payout', {
          currency: 'TON',
          address: connectedAddress.trim(),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Could not save TON wallet');
      }
      return (await apiRequest('POST', '/api/payouts', { goldAmount: Number(amount) })).json();
    },
    onSuccess: (data) => {
      if (!data.success) throw new Error(data.message);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
      showNotification('GEM withdrawal request sent to admin', 'success');
      onClose();
    },
    onError: (error: any) => showNotification(error.message || 'Could not create withdrawal request', 'error'),
  });

  const value = Number(amount || 0);
  const netUsd = (value / 100000) * (1 - feePercent / 100);
  const canSubmit = !secondaryAccountBlocked && Boolean(address) && Number.isInteger(value) && value >= minimum && value <= userBalance && tonPrice > 0 && !withdrawal.isPending;
  const handleMax = () => setAmount(String(Math.floor(userBalance)));
  const openWallet = async () => {
    try {
      await tonConnectUI.openModal();
    } catch (error: any) {
      showNotification(error?.message || 'Could not open TON wallet connection', 'error');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[1200] flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-t-2xl overflow-hidden"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            style={{ maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
            <div className="flex items-center px-5 py-3 border-b border-white/5">
              <h2 className="text-white font-bold text-base">GEM Withdrawal</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              {secondaryAccountBlocked && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs leading-relaxed text-red-100">
                  This is not your active account. Your original account is <b>{user?.primaryAccountName || 'the first account created on this device'}</b>. Withdrawals are disabled here.
                </div>
              )}
              <div className="bg-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
                <span className="text-white text-xs font-semibold">Available Balance</span>
                <span className="text-white text-sm font-black tabular-nums inline-flex items-center gap-1.5">
                  <img src="/assets/gems-icon.svg" alt="GEM" className="w-5 h-5 object-contain" />
                  {Math.floor(userBalance).toLocaleString()} GEM
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-white/40 text-[10px] font-black uppercase tracking-widest">TON wallet address</label>
                </div>
                <div className="flex justify-center">
                  <button type="button" onClick={openWallet} className="h-10 px-4 rounded-[10px] border border-[#0098ea]/50 bg-[#0098ea] text-white text-xs font-extrabold shadow-[0_4px_14px_rgba(0,152,234,0.2)]">
                    {connectedAddress ? 'TON Wallet Connected' : 'Connect TON Wallet'}
                  </button>
                </div>
                {address && <div className="bg-white/5 border border-white/10 text-white h-11 rounded-xl px-3 flex items-center text-xs font-medium truncate">{address}</div>}
                {connectedAddress && !savedAddress && (
                  <button onClick={() => saveWallet.mutate()} disabled={saveWallet.isPending} className="w-full h-10 bg-[#007AFF]/15 hover:bg-[#007AFF]/25 text-[#60a5fa] rounded-xl text-xs font-black uppercase tracking-wider">
                    {saveWallet.isPending ? 'Saving…' : 'Use Connected Wallet'}
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-white/40 text-[10px] font-black uppercase tracking-widest">GEM amount</label>
                <div className="relative">
                  <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder={minimum.toLocaleString()} className="w-full bg-white/5 border border-white/10 text-white h-11 rounded-xl font-bold text-sm px-3.5 pr-16 placeholder:text-white/20 focus:outline-none focus:border-[#0066D6]/40" />
                  <button onClick={handleMax} className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-white hover:bg-gray-200 text-gray-700 text-[10px] font-black rounded-lg uppercase">Max</button>
                </div>
                {value > 0 && value < minimum && <p className="text-red-400 text-[11px]">Minimum {minimum.toLocaleString()} GEM required</p>}
              </div>
              <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">Withdraw Fee</span><span className="text-white text-xs font-bold">{feePercent}%</span></div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">Min. Withdrawal</span><span className="text-white text-xs font-bold">{minimum.toLocaleString()} GEM</span></div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">You Receive</span><span className="text-white text-sm font-black tabular-nums">{tonPrice > 0 && value > 0 ? `$${netUsd.toFixed(3)} USD` : '—'}</span></div>
              </div>
              <button onClick={() => withdrawal.mutate()} disabled={!canSubmit} className="w-full h-11 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-50 border-0 flex items-center justify-center gap-2">
                {withdrawal.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Withdraw GEM'}
              </button>
              <button onClick={onClose} className="w-full text-white/40 text-xs font-bold uppercase tracking-wider py-2 hover:text-white/60 transition-colors">Close</button>
            </div>
            <div className="h-4" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
