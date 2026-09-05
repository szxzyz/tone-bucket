import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import Layout from '@/components/Layout';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';
import { useAuth } from '@/hooks/useAuth';

const GEMS_PER_USD = 100000;
const CARD = '#333333';
const TEXT_DIM = 'rgba(255,255,255,0.38)';

type WithdrawalHistoryItem = {
  id: string | number;
  amount?: string | number;
  method?: string;
  status: string;
  details?: unknown;
  createdAt: string;
};

type WithdrawalHistoryResponse = {
  success?: boolean;
  withdrawals?: WithdrawalHistoryItem[];
};

export default function Withdraw() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [balanceHidden, setBalanceHidden] = useState(false);
  const [address, setAddress] = useState('');
  const [amountGold, setAmountGold] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    staleTime: 60000,
    retry: false,
  });

  const { data: eligibility } = useQuery<any>({
    queryKey: ['/api/withdrawal-eligibility'],
    staleTime: 30000,
    retry: false,
  });

  const { data: tonPrice = 5.5 } = useQuery<number>({
    queryKey: ['/api/ton-price'],
    queryFn: async () => {
      const response = await fetch('/api/ton-price');
      if (!response.ok) return 5.5;
      const data = await response.json();
      return Number(data.price) || 5.5;
    },
    staleTime: 30000,
    retry: false,
  });

  const { data: withdrawalHistoryResponse, isLoading: isHistoryLoading } = useQuery<WithdrawalHistoryResponse>({
    queryKey: ['/api/withdrawals'],
    queryFn: async () => {
      const response = await fetch('/api/withdrawals', { credentials: 'include' });
      if (!response.ok) return { success: false, withdrawals: [] };
      return response.json();
    },
    retry: false,
  });
  const withdrawalHistory = withdrawalHistoryResponse?.withdrawals ?? [];

  const rawGoldBalance = Number.parseFloat(String(user?.balance ?? '0')) || 0;
  const goldBalance = Math.floor(rawGoldBalance);
  const balanceUSD = rawGoldBalance / GEMS_PER_USD;
  const balanceTON = balanceUSD / tonPrice;
  const balanceUSDDisplay = balanceUSD.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: balanceUSD < 0.01 ? 6 : 4,
  });
  const balanceTONDisplay = balanceTON.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  const goldBalanceDisplay = goldBalance.toLocaleString();
  const configuredMinimumWithdrawalUSD = Number(appSettings?.minimumWithdrawAmount);
  const configuredMaximumWithdrawalUSD = Number(appSettings?.maximumWithdrawAmount);
  const minimumWithdrawalUSD = Number.isFinite(configuredMinimumWithdrawalUSD) ? configuredMinimumWithdrawalUSD : 0.20;
  const maximumWithdrawalUSD = Number.isFinite(configuredMaximumWithdrawalUSD) ? configuredMaximumWithdrawalUSD : 0.50;
  const minimumWithdrawalGold = Math.round(minimumWithdrawalUSD * GEMS_PER_USD);
  const maximumWithdrawalGold = Math.round(maximumWithdrawalUSD * GEMS_PER_USD);

  const feePercent = useMemo(
    () => Number.parseFloat(String(appSettings?.withdrawalFeeTON ?? '5')) || 5,
    [appSettings],
  );
  const amountUSD = useMemo(
    () => (amountGold ? Number.parseFloat(amountGold) / GEMS_PER_USD : 0),
    [amountGold],
  );
  const diamondBalance = useMemo(
    () => Math.floor(Number.parseFloat(String(user?.diamondBalance ?? '0')) || 0),
    [user?.diamondBalance],
  );
  const requiredDiamonds = useMemo(
    () => Math.max(0, Math.floor(Number.parseFloat(amountGold) || 0)),
    [amountGold],
  );
  const hasMatchingDiamonds = diamondBalance >= requiredDiamonds;
  const feeUSD = useMemo(() => amountUSD * (feePercent / 100), [amountUSD, feePercent]);
  const netUSD = useMemo(() => Math.max(0, amountUSD - feeUSD), [amountUSD, feeUSD]);
  const netTON = useMemo(() => netUSD / tonPrice, [netUSD, tonPrice]);
  const parsedAmountGold = Number.parseFloat(amountGold) || 0;
  const amountInAdminRange = parsedAmountGold >= minimumWithdrawalGold && parsedAmountGold <= maximumWithdrawalGold;
  const amountWithinBalance = parsedAmountGold <= goldBalance;

  const requirements = useMemo(() => [
    {
      label: 'invite',
      current: eligibility?.friendsInvited || 0,
      required: eligibility?.requiredInvites || 3,
      enabled: eligibility?.inviteRequirementEnabled,
    },
    {
      label: 'task',
      current: eligibility?.tasksCompleted || 0,
      required: eligibility?.requiredTasks || 10,
      enabled: eligibility?.taskRequirementEnabled,
    },
    {
      label: 'ads',
      current: eligibility?.adsWatchedSinceLastWithdrawal || 0,
      required: eligibility?.requiredAds || 100,
      enabled: eligibility?.adRequirementEnabled,
    },
  ].filter((requirement) => requirement.enabled), [eligibility]);

  const allRequirementsMet = useMemo(
    () => requirements.every((requirement) => requirement.current >= requirement.required),
    [requirements],
  );
  const dailyLimitReached = useMemo(
    () => eligibility?.todayWithdrawalCount >= eligibility?.maxWithdrawalsPerDay,
    [eligibility],
  );

  const handleMax = () => {
    const maximumAvailableGold = Math.min(goldBalance, maximumWithdrawalGold);
    if (maximumAvailableGold > 0) setAmountGold(String(maximumAvailableGold));
  };

  const withdrawMutation = useMutation({
    mutationFn: async (data: { method: string; axnAmount: number; tonWalletAddress: string }) => {
      const response = await apiRequest('POST', '/api/withdrawals', data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        showNotification('Withdrawal request submitted!', 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        queryClient.invalidateQueries({ queryKey: ['/api/withdrawal-eligibility'] });
        queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
        setAddress('');
        setAmountGold('');
      } else {
        showNotification(data.message || 'Failed to submit withdrawal', 'error');
      }
    },
    onError: (error: any) => {
      showNotification(error.message || 'Withdrawal failed', 'error');
    },
    onSettled: () => setIsSubmitting(false),
  });

  const handleSubmit = () => {
    if (!address.trim()) {
      showNotification('Please enter a wallet address', 'error');
      return;
    }
    if (!amountGold || parsedAmountGold <= 0) {
      showNotification('Please enter a valid amount', 'error');
      return;
    }
    if (parsedAmountGold < minimumWithdrawalGold) {
      showNotification(`Minimum withdrawal is ${minimumWithdrawalGold.toLocaleString()} Gold ($${minimumWithdrawalUSD.toFixed(2)})`, 'error');
      return;
    }
    if (parsedAmountGold > maximumWithdrawalGold) {
      showNotification(`Maximum withdrawal is ${maximumWithdrawalGold.toLocaleString()} Gold ($${maximumWithdrawalUSD.toFixed(2)})`, 'error');
      return;
    }
    if (!amountWithinBalance) {
      showNotification('Insufficient Gold balance', 'error');
      return;
    }

    setIsSubmitting(true);
    withdrawMutation.mutate({
      method: 'TON',
      axnAmount: parsedAmountGold,
      tonWalletAddress: address.trim(),
    });
  };

  const isPending = isSubmitting || withdrawMutation.isPending;
  const isSubmitDisabled =
    isPending ||
    !allRequirementsMet ||
    dailyLimitReached ||
    !hasMatchingDiamonds ||
    !amountInAdminRange ||
    !amountWithinBalance ||
    !amountGold ||
    parsedAmountGold <= 0;

  const formatHistoryDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getHistoryDetails = (item: WithdrawalHistoryItem) => {
    if (typeof item.details === 'object' && item.details !== null) {
      return item.details as Record<string, unknown>;
    }
    if (typeof item.details === 'string') {
      try {
        const parsed = JSON.parse(item.details);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  const getHistoryTonAmount = (item: WithdrawalHistoryItem) => {
    const details = getHistoryDetails(item);
    const netUsd = Number.parseFloat(String(details.netAmount ?? ''));
    if (Number.isFinite(netUsd)) return (netUsd / tonPrice).toFixed(4);
    const goldAmount = Number.parseFloat(String(details.axnAmount ?? ''));
    if (Number.isFinite(goldAmount)) {
      const netGoldUSD = (goldAmount / GEMS_PER_USD) * (1 - feePercent / 100);
      return (netGoldUSD / tonPrice).toFixed(4);
    }
    const usdAmount = Number.parseFloat(String(item.amount ?? '0')) || 0;
    return (usdAmount / tonPrice).toFixed(4);
  };

  const getHistoryWalletAddress = (item: WithdrawalHistoryItem) => {
    const details = getHistoryDetails(item);
    return String(details.tonWalletAddress ?? details.walletAddress ?? details.paymentDetails ?? '');
  };

  const shortenWalletAddress = (addressValue: string) => {
    if (addressValue.length <= 16) return addressValue;
    return `${addressValue.slice(0, 10)}...`;
  };

  const getHistoryStatusColor = (status: string) => {
    const normalized = status.toLowerCase();
    if (normalized.includes('approved') || normalized.includes('success') || normalized.includes('paid')) return '#22c55e';
    if (normalized.includes('reject')) return '#ef4444';
    return '#f59e0b';
  };

  const getHistoryStatusLabel = (status: string) => {
    const normalized = status.toLowerCase();
    if (normalized.includes('approved') || normalized.includes('success') || normalized.includes('paid')) return 'completed';
    if (normalized.includes('reject')) return 'rejected';
    return 'pending';
  };

  const copyWalletAddress = async (addressValue: string) => {
    if (!addressValue) return;
    try {
      await navigator.clipboard.writeText(addressValue);
      showNotification('Wallet address copied', 'success');
    } catch {
      showNotification('Could not copy wallet address', 'error');
    }
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 text-white" style={{ paddingTop: 16, paddingBottom: 104 }}>
        <style>{`.withdraw-amount-input::placeholder { color: rgba(255,255,255,0.65); opacity: 1; }`}</style>
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Total Balance
          </div>
          <div className="flex items-center gap-2" style={{ marginBottom: 5 }}>
            <span
              style={{
                fontSize: balanceUSDDisplay.length > 16 ? 22 : balanceUSDDisplay.length > 12 ? 28 : 38,
                fontWeight: 700,
                color: '#fff',
                fontFamily: 'Roboto Mono',
                letterSpacing: '-0.5px',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                wordBreak: 'break-all',
              }}
            >
              {balanceHidden ? '••••' : balanceUSDDisplay}
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>USDT</span>
            <button
              type="button"
              onClick={() => setBalanceHidden((hidden) => !hidden)}
              aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,0.3)' }}
            >
              {balanceHidden ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="flex items-center gap-3 flex-wrap" style={{ color: TEXT_DIM, fontSize: 12, fontWeight: 500 }}>
            <span>{balanceHidden ? '≈ •••• TON' : `≈ ${balanceTONDisplay} TON`}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
            <span className="inline-flex items-center gap-1">
              {balanceHidden ? '≈ ••••' : <>≈ {goldBalanceDisplay} <img src="/assets/gold-icon.png" alt="Gold" style={{ width: 16, height: 16, objectFit: 'contain' }} /></>}
            </span>
          </div>
        </section>

        <section style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', marginBottom: 4 }}>
            Withdraw your gold to TON
          </div>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="ton-wallet-address" style={{ display: 'block', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
              TON WALLET ADDRESS
            </label>
            <input
              id="ton-wallet-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="UQ... Wallet address"
              autoComplete="off"
              style={{ width: '100%', height: 50, boxSizing: 'border-box', background: CARD, border: 'none', borderRadius: 12, padding: '0 14px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label htmlFor="withdraw-gold-amount" style={{ display: 'block', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
              AMOUNT
            </label>
            <div style={{ position: 'relative' }}>
              <img src="/assets/gold-icon.png" alt="Gold" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%' }} />
              <input
                id="withdraw-gold-amount"
                className="withdraw-amount-input"
                type="number"
                min={minimumWithdrawalGold}
                max={maximumWithdrawalGold}
                value={amountGold}
                onChange={(event) => setAmountGold(event.target.value)}
                placeholder="0"
                style={{ width: '100%', height: 50, boxSizing: 'border-box', background: '#000', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '0 60px 0 44px', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none' }}
              />
              <button
                type="button"
                onClick={handleMax}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 48, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', color: '#fff', background: '#000', padding: 0, borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer' }}
              >
                MAX
              </button>
            </div>
            {requiredDiamonds > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
                  REQUIRED DIAMONDS
                </div>
                <div className="flex items-center justify-between" style={{ width: '100%', height: 50, boxSizing: 'border-box', background: CARD, borderRadius: 12, padding: '0 14px' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>Requirement</span>
                  <div className="flex items-center gap-2">
                    <img src="/assets/diamonds.png" alt="Diamond" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                    <span style={{ fontSize: 16, fontWeight: 900, color: hasMatchingDiamonds ? '#10b981' : '#ef4444' }}>{requiredDiamonds.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {requirements.length > 0 && (
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 6 }}>
              {requirements.map((requirement) => {
                const isMet = requirement.current >= requirement.required;
                return (
                  <div key={requirement.label} style={{ fontSize: 11, fontWeight: 800, padding: '6px 10px', borderRadius: 10, background: isMet ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: isMet ? '#10b981' : '#ef4444' }}>
                    ({requirement.current}/{requirement.required} {requirement.label})
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, marginBottom: 6 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>YOU RECEIVE</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{netUSD.toFixed(4)} USDT</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginTop: 1 }}>≈ {netTON.toFixed(6)} TON</div>
              </div>
            </div>
            <div className="flex items-center justify-between" style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
              <span>FEE ({feePercent}%)</span>
              <span>-{feeUSD.toFixed(4)} USDT</span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
            style={{ width: '100%', height: 54, borderRadius: 14, border: 'none', background: !isSubmitDisabled ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.06)', color: !isSubmitDisabled ? '#fff' : 'rgba(255,255,255,0.25)', fontSize: 15, fontWeight: 900, cursor: isSubmitDisabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: !isSubmitDisabled ? '0 8px 20px rgba(37,99,235,0.3)' : 'none' }}
            className="active:scale-95 transition-transform"
          >
            {isPending ? <Loader2 size={20} className="animate-spin" /> : dailyLimitReached ? 'DAILY LIMIT REACHED' : !allRequirementsMet ? 'REQUIREMENTS NOT MET' : !hasMatchingDiamonds ? 'DIAMONDS NOT ENOUGH' : 'SUBMIT WITHDRAWAL'}
          </button>

          {dailyLimitReached && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#ef4444', fontWeight: 700 }}>
              Daily limit reached ({eligibility?.maxWithdrawalsPerDay} per day)
            </div>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            History
          </div>
          {isHistoryLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0', color: '#3b82f6' }}>
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : withdrawalHistory.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '14px 0' }}>
              No withdrawal history yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {withdrawalHistory.map((withdrawal) => {
                const status = withdrawal.status || 'pending';
                const statusColor = getHistoryStatusColor(status);
                const walletAddress = getHistoryWalletAddress(withdrawal);
                return (
                  <div key={withdrawal.id} style={{ background: '#333333', borderRadius: 16, overflow: 'hidden' }}>
                    <div className="flex items-center justify-between gap-3" style={{ padding: '17px 16px', background: 'rgba(255,255,255,0.025)' }}>
                      <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                        <span style={{ color: '#fff', fontSize: 23, fontWeight: 700, fontFamily: 'Roboto Mono', letterSpacing: '-0.4px', lineHeight: 1 }}>
                          {getHistoryTonAmount(withdrawal)}
                        </span>
                        <img src="/ton-icon.png" alt="TON" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
                      </div>
                      <span style={{ color: statusColor, fontSize: 14, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'lowercase', flexShrink: 0 }}>
                        {getHistoryStatusLabel(status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3" style={{ padding: '14px 16px', background: '#101010' }}>
                      <div className="flex items-center gap-2" style={{ minWidth: 0, color: 'rgba(255,255,255,0.65)' }}>
                        <CalendarDays size={20} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 14, fontFamily: 'Roboto Mono', letterSpacing: '-0.2px', whiteSpace: 'nowrap' }}>
                          {formatHistoryDate(withdrawal.createdAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyWalletAddress(walletAddress)}
                        disabled={!walletAddress}
                        aria-label={walletAddress ? 'Copy wallet address' : 'Wallet address unavailable'}
                        className="flex items-center gap-2"
                        style={{ maxWidth: '58%', minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.65)', cursor: walletAddress ? 'pointer' : 'default' }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontFamily: 'Roboto Mono' }}>
                          {walletAddress ? shortenWalletAddress(walletAddress) : 'Wallet unavailable'}
                        </span>
                        {walletAddress && <Copy size={20} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}
