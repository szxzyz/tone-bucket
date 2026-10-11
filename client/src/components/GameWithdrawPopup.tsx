import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';

type Props = { open: boolean; onClose: () => void; userBalance: number };

export default function GameWithdrawPopup({ open, onClose, userBalance }: Props) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const connectedAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], enabled: open, retry: false });
  const { data: settings } = useQuery<any>({ queryKey: ['/api/app-settings'], enabled: open, retry: false, staleTime: 60000 });
  const { data: eligibility, isLoading: eligibilityLoading } = useQuery<any>({
    queryKey: ['/api/withdrawal-eligibility'],
    enabled: open,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const savedAddress = user?.payoutCurrency === 'AXN' ? (user?.payoutWalletAddress || '') : '';
  const address = connectedAddress || savedAddress;
  const minimum = Math.max(1, Math.floor(Number(settings?.minimumCashoutGold || 1000)));
  const availableAxn = Math.max(0, Math.floor(Number(user?.balance ?? userBalance ?? 0)));
  const feePercent = Math.max(0, Math.min(100, Number(settings?.withdrawalFeeTON ?? 9)));
  const secondaryAccountBlocked = Boolean(user?.secondaryAccountBlocked);

  const saveWallet = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', '/api/wallet/payout', { currency: 'AXN', address: address.trim() })).json(),
    onSuccess: (data) => {
      if (!data.success) throw new Error(data.message);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawal-eligibility'] });
      showNotification('AXN payout address saved successfully', 'success');
    },
    onError: (error: any) => showNotification(error.message || 'Could not save payout address', 'error'),
  });

  const withdrawal = useMutation({
    mutationFn: async () => {
      if (connectedAddress && connectedAddress !== savedAddress) {
        const response = await apiRequest('PATCH', '/api/wallet/payout', {
          currency: 'AXN',
          address: connectedAddress.trim(),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Could not save payout address');
      }
      return (await apiRequest('POST', '/api/payouts', { axnAmount: Number(amount), address: address.trim() })).json();
    },
    onSuccess: (data) => {
      if (!data.success) throw new Error(data.message);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawal-eligibility'] });
      showNotification('AXN withdrawal request sent to admin', 'success');
      setAmount('');
      onClose();
    },
    onError: (error: any) => showNotification(error.message || 'Could not create AXN withdrawal request', 'error'),
  });

  const value = Number(amount || 0);
  const feeAxn = value * feePercent / 100;
  const netAxn = value - feeAxn;
  const canSubmit = !secondaryAccountBlocked && eligibility?.canWithdraw === true && Boolean(address) &&
    Number.isInteger(value) && value >= minimum && value <= availableAxn && !withdrawal.isPending;
  const handleMax = () => setAmount(String(availableAxn));
  const openWallet = async () => {
    try {
      if (connectedAddress) await tonConnectUI.disconnect();
      await tonConnectUI.openModal();
    } catch (error: any) {
      showNotification(error?.message || 'Could not open payout wallet connection', 'error');
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
              <h2 className="text-white font-bold text-base">AXN Withdrawal</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              {secondaryAccountBlocked && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs leading-relaxed text-red-100">
                  This is not your active account. Your original account is <b>{user?.primaryAccountName || 'the first account created on this device'}</b>. Withdrawals are disabled here.
                </div>
              )}
              <div className="bg-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
                <span className="text-white text-xs font-semibold">Available AXN</span>
                <span className="text-white text-sm font-black tabular-nums inline-flex items-center gap-1.5">
                  <img src="/assets/axionet-mining.webp" alt="AXN" className="w-5 h-5 object-contain" />
                  {availableAxn.toLocaleString()} AXN
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-white/40 text-[10px] font-black uppercase tracking-widest">AXN payout address</label>
                </div>
                <div className="flex justify-center">
                  <button type="button" onClick={openWallet} className="h-9 px-4 rounded-lg border border-[#0098ea]/55 bg-[#0098ea] text-white text-sm font-bold shadow-[0_2px_8px_rgba(0,152,234,0.22)]">
                    {connectedAddress || savedAddress ? 'CHANGE ADDRESS' : 'Connect payout wallet'}
                  </button>
                </div>
                {address && <div className="bg-white/5 border border-white/10 text-white h-11 rounded-xl px-3 flex items-center text-xs font-medium truncate">{address}</div>}
                {connectedAddress && connectedAddress !== savedAddress && (
                  <button onClick={() => saveWallet.mutate()} disabled={saveWallet.isPending} className="w-full h-10 bg-[#007AFF]/15 hover:bg-[#007AFF]/25 text-[#60a5fa] rounded-xl text-xs font-black uppercase tracking-wider">
                    {saveWallet.isPending ? 'Saving…' : 'Use Connected Wallet'}
                  </button>
                )}
                <p className="text-white/40 text-[10px]">An admin reviews requests and sends AXN manually after approval.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-white/40 text-[10px] font-black uppercase tracking-widest">AXN amount</label>
                <div className="relative">
                  <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder={minimum.toLocaleString()} className="w-full bg-white/5 border border-white/10 text-white h-11 rounded-xl font-bold text-sm px-3.5 pr-16 placeholder:text-white/20 focus:outline-none focus:border-[#0066D6]/40" />
                  <button onClick={handleMax} className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-white hover:bg-gray-200 text-gray-700 text-[10px] font-black rounded-lg uppercase">Max</button>
                </div>
                {value > 0 && value < minimum && <p className="text-red-400 text-[11px]">Minimum {minimum.toLocaleString()} AXN required</p>}
                {value > availableAxn && <p className="text-red-400 text-[11px]">Amount exceeds your available AXN balance</p>}
              </div>
              <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">Withdrawal fee</span><span className="text-white text-xs font-bold">{feePercent}% ({value > 0 ? feeAxn.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} AXN)</span></div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">Minimum withdrawal</span><span className="text-white text-xs font-bold">{minimum.toLocaleString()} AXN</span></div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">Available to withdraw</span><span className="text-white text-xs font-bold">{availableAxn.toLocaleString()} AXN</span></div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center"><span className="text-white/50 text-xs font-semibold">You receive</span><span className="text-white text-sm font-black tabular-nums">{value > 0 ? `${netAxn.toLocaleString(undefined, { maximumFractionDigits: 2 })} AXN` : '—'}</span></div>
              </div>
              <div className="bg-white/5 rounded-xl px-4 py-3 space-y-2 text-[11px]">
                <p className="text-white/70 font-black uppercase tracking-wider">Withdrawal requirements</p>
                {eligibilityLoading && <p className="text-white/45">Checking your progress…</p>}
                {!eligibilityLoading && eligibility && (
                  <>
                    {eligibility.adRequirementEnabled && <p className={Number(eligibility.adsWatchedSinceLastWithdrawal) >= Number(eligibility.requiredAds) ? 'text-green-400' : 'text-white/55'}>Ads since last withdrawal: {eligibility.adsWatchedSinceLastWithdrawal}/{eligibility.requiredAds}</p>}
                    {eligibility.taskRequirementEnabled && <p className={Number(eligibility.tasksCompleted) >= Number(eligibility.requiredTasks) ? 'text-green-400' : 'text-white/55'}>Tasks completed: {eligibility.tasksCompleted}/{eligibility.requiredTasks}</p>}
                    {eligibility.inviteRequirementEnabled && <p className={Number(eligibility.friendsInvited) >= Number(eligibility.requiredInvites) ? 'text-green-400' : 'text-white/55'}>Valid friends invited: {eligibility.friendsInvited}/{eligibility.requiredInvites}</p>}
                    <p className={Number(eligibility.todayWithdrawalCount) < Number(eligibility.maxWithdrawalsPerDay) ? 'text-green-400' : 'text-white/55'}>Withdrawals today: {eligibility.todayWithdrawalCount}/{eligibility.maxWithdrawalsPerDay}</p>
                    {eligibility.pendingWithdrawal && <p className="text-amber-300">A withdrawal is already awaiting admin processing.</p>}
                  </>
                )}
                {!eligibilityLoading && !eligibility && <p className="text-red-300">Could not check withdrawal requirements. Reopen this window to retry.</p>}
              </div>
              <button onClick={() => withdrawal.mutate()} disabled={!canSubmit} className="w-full h-11 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-50 border-0 flex items-center justify-center gap-2">
                {withdrawal.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Request AXN Withdrawal'}
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
