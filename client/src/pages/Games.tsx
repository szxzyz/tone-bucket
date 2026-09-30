import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import MenuPopup from "@/components/GameMenuPopup";
import MiningAXNGameHeader from "@/components/MiningAXNGameHeader";
import BottomNav from "@/components/BottomNav";
import GameWithdrawPopup from "@/components/GameWithdrawPopup";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import GameBalanceCard from "@/components/GameBalanceCard";
import { showAdgramAd } from "@/lib/showAd";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

type GameActionCardProps = {
  title: string;
  illustration: React.ReactNode;
  actionLabel: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

function GameActionCard({ title, illustration, actionLabel, disabled = false, busy = false, onClick }: GameActionCardProps) {
  const unavailable = disabled || busy;
  return (
    <button
      type="button"
      aria-label={`${title}: ${busy ? 'Loading' : actionLabel}`}
      onClick={onClick}
      disabled={unavailable}
      className="group active:scale-[0.98] transition-transform"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 7, position: 'relative',
        minWidth: 0, minHeight: 146, width: '100%', padding: 8, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
        background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)',
        color: '#fff', cursor: unavailable ? 'not-allowed' : 'pointer',
        boxShadow: '0 8px 22px rgba(0,0,0,0.25)', opacity: unavailable ? 0.68 : 1,
      }}
    >
      <span aria-hidden="true" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: 76, flexShrink: 0, overflow: 'hidden',
      }}>
        {illustration}
      </span>
      <span aria-hidden="true" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: '100%', height: 36, minHeight: 36, boxSizing: 'border-box', marginTop: 'auto',
        borderRadius: 12,
        background: unavailable ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
        color: unavailable ? 'rgba(255,255,255,0.45)' : '#fff',
        fontSize: 10, lineHeight: 1, fontWeight: 900, letterSpacing: '0.03em', whiteSpace: 'nowrap',
      }}>
        {busy && <span style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />}
        {busy ? 'PLEASE WAIT' : actionLabel}
      </span>
    </button>
  );
}

export default function Games() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showGiftCodePopup, setShowGiftCodePopup] = useState(false);
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const [dailyChecked, setDailyChecked] = useState(() => localStorage.getItem('daily_check_date') === getTodayKey());
  const [dailyAdLoading, setDailyAdLoading] = useState(false);

  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], staleTime: 300000, retry: false });
  const { data: swapSettings } = useQuery<{ swapRate: number; swapMinCipher: number }>({ queryKey: ['/api/swap-config'], staleTime: 60000 });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ['/api/daily-checkin/status'],
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const runVerifiedAdsgramReward = async (context: 'daily_checkin') => {
    const sessionId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let backgroundEntered = false;
    let backgroundStartedAt = 0;
    let backgroundDuration = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        backgroundEntered = true;
        backgroundStartedAt = Date.now();
      } else if (backgroundStartedAt) {
        backgroundDuration += Date.now() - backgroundStartedAt;
        backgroundStartedAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    try {
      const register = await apiRequest('POST', '/api/ads/register-session', { sessionId, adType: 'adsgram', context });
      if (!register.ok) throw new Error('Could not start ad session');
      await showAdgramAd(appConfig?.adsgramRewardBlockId || '');
      if (document.visibilityState === 'hidden') {
        await new Promise<void>(resolve => {
          const onVisible = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVisible); resolve(); } };
          document.addEventListener('visibilitychange', onVisible);
        });
      }
      if (backgroundStartedAt) backgroundDuration += Date.now() - backgroundStartedAt;
      return { sessionId, backgroundEntered, backgroundDuration };
    } finally {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  const axnRaw = parseFloat(user?.walletBalance ?? user?.balance ?? '0');
  const rawGoldBalance = Number.parseFloat(String(user?.balance ?? '0'));
  const goldBalance = Number.isFinite(rawGoldBalance)
    ? rawGoldBalance < 1 ? Math.round(rawGoldBalance * 10_000_000) : Math.round(rawGoldBalance)
    : 0;

  useEffect(() => {
    if (!user) return;
    // The server owns the IST-midnight reset boundary. Prefer its status so
    // stale UTC localStorage/user fields cannot keep a new-day claim locked.
    if (checkinStatus && typeof checkinStatus.alreadyClaimedToday === 'boolean') {
      setDailyChecked(checkinStatus.alreadyClaimedToday);
      if (!checkinStatus.alreadyClaimedToday) localStorage.removeItem('daily_check_date');
    } else {
      const todayKey = getTodayKey();
      if (user.dailyCheckinClaimed && user.dailyTasksDate) {
        const serverDate = new Date(user.dailyTasksDate).toISOString().slice(0, 10);
        if (serverDate === todayKey) {
          setDailyChecked(true);
          localStorage.setItem('daily_check_date', todayKey);
        } else {
          setDailyChecked(false);
          localStorage.removeItem('daily_check_date');
        }
      } else if (!user.dailyCheckinClaimed) {
        setDailyChecked(false);
        localStorage.removeItem('daily_check_date');
      }
    }
  }, [user, checkinStatus]);

  const dailyCheckMutation = useMutation({
    mutationFn: async (session: { sessionId: string; backgroundEntered: boolean; backgroundDuration: number }) => {
      const res = await apiRequest('POST', '/api/daily-checkin', session);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: (data) => {
      setDailyChecked(true);
      localStorage.setItem('daily_check_date', getTodayKey());
      showNotification(`Daily check-in done! +${data.reward ?? 5} Gold added`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Daily check-in failed. Try again.', 'error');
    },
  });

  const handleDailyCheck = async () => {
    if (dailyChecked || dailyAdLoading || dailyCheckMutation.isPending) return;
    setDailyAdLoading(true);
    let session;
    try { session = await runVerifiedAdsgramReward('daily_checkin'); } catch (error: any) { setDailyAdLoading(false); showNotification(error?.message || 'Ad could not be completed', 'error'); return; }
    setDailyAdLoading(false);
    dailyCheckMutation.mutate(session);
  };

  return (
    <div style={{ height: '100dvh', background: '#090909', overflowY: 'auto', overflowX: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes boxPulse {
          0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(61,21,128,0.4); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(61,21,128,0); }
        }
        @keyframes rewardIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes axn-glow { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
        @keyframes axn-pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes popup-glow { 0%,100%{opacity:0.5} 50%{opacity:1} }
        .game-action-card-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; max-width: 680px; margin: 0 auto; }
      `}</style>

      <MiningAXNGameHeader onMenuOpen={() => setMenuOpen(true)} />

      {/* Scrollable Content */}
      <div style={{ padding: 'calc(var(--header-height, 62px) + 14px) clamp(12px, 4vw, 20px)', paddingBottom: 'max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))', width: '100%', boxSizing: 'border-box' }}>
        <GameBalanceCard balance={goldBalance} onWithdraw={() => setShowWithdrawPopup(true)} />
        <h2 style={{ maxWidth: 680, margin: '0 auto 10px', color: '#fff', fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>Fast Access</h2>
        <div className="game-action-card-grid">
          <GameActionCard
            title="Daily Rewards"
            actionLabel={dailyChecked ? 'CLAIMED' : 'CHECK IN'}
            disabled={dailyChecked}
            busy={dailyAdLoading || dailyCheckMutation.isPending}
            onClick={() => setCheckinSheetOpen(true)}
            illustration={<img src="/assets/daily-checkin.png" alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />}
          />
          <GameActionCard
            title="Gift Code"
            actionLabel="REDEEM"
            onClick={() => setShowGiftCodePopup(true)}
            illustration={<img src="/assets/gift-code-card.png" alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />}
          />
          <GameActionCard
            title="Withdraw"
            actionLabel="WITHDRAW"
            onClick={() => setShowWithdrawPopup(true)}
            illustration={<img src="/assets/withdraw-card.png" alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />}
          />
        </div>
      </div>

      {menuOpen && (
        <MenuPopup
          onClose={() => setMenuOpen(false)}
        />
      )}
      {showGiftCodePopup && (
        <PromoPopup
          onClose={() => setShowGiftCodePopup(false)}
          onSuccess={() => {
            setShowGiftCodePopup(false);
            queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
          }}
        />
      )}
      <DailyCheckinSheet
        open={checkinSheetOpen}
        onClose={() => setCheckinSheetOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? dailyChecked}
        onClaimed={() => { setDailyChecked(true); setCheckinSheetOpen(false); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); queryClient.invalidateQueries({ queryKey: ['/api/daily-checkin/status'] }); }}
      />
      <GameWithdrawPopup open={showWithdrawPopup} onClose={() => setShowWithdrawPopup(false)} userBalance={Math.floor(axnRaw)} />
      <BottomNav />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _SendChoicePopupRemoved({ user, onClose, onWithdraw, onSuccess }: {
  user: any;
  onClose: () => void;
  onWithdraw: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<null | 'user'>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const usdPreview = '';

  const handleSend = async () => {
    if (!recipient || !amount) { showNotification('Fill in recipient and amount', 'error'); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { showNotification('Enter a valid amount', 'error'); return; }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/transfers/send', { recipient, amount: num, note });
      const data = await res.json();
      if (data.success) {
        showNotification(`Sent ${num} Gold successfully!`, 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Transfer failed', 'error');
      }
    } catch {
      showNotification('Transfer failed. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '13px 14px', borderRadius: 14,
    border: '1.5px solid rgba(61,21,128,0.24)',
    fontSize: 15, color: '#fff',
    background: 'rgba(255,255,255,0.04)', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24), 0 0 0 1px rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mode ? 22 : 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode && (
              <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              </button>
            )}
            <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
              {mode === 'user' ? 'Send to User' : 'Send Gold'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setMode('user')} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(61,21,128,0.09)', border: '1px solid rgba(61,21,128,0.2)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(61,21,128,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2" fill="white" stroke="none" opacity="0.9"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Send to User</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Internal transfer using User ID</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button onClick={onWithdraw} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.18)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #5b21b6, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Withdraw</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Send to external TON wallet</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        )}

        {mode === 'user' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient User ID</div>
              <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Enter User ID..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount (Gold)</div>
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0" style={inputStyle} />
              {usdPreview && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 5 }}>{usdPreview}</div>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Note (optional)</div>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note..." style={inputStyle} />
            </div>
            <button
              onClick={handleSend}
              disabled={loading}
              style={{
                width: '100%', padding: '14px',
                background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
                fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(61,21,128,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              {loading ? 'Sending...' : 'Send Gold'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _ReceivePopupRemoved({ user, onClose }: { user: any; onClose: () => void }) {
  const copyId = () => {
    const id = user?.id?.toString() || '';
    navigator.clipboard.writeText(id).then(() => showNotification('User ID copied!', 'success')).catch(() => {});
  };
  const copyUsername = () => {
    const un = user?.username || '';
    navigator.clipboard.writeText(un).then(() => showNotification('Username copied!', 'success')).catch(() => {});
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Receive Gold</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 20 }}>
          Share your User ID or username so others can send you Gold directly.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>User ID</div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'Roboto Mono' }}>{user?.id ?? '—'}</div>
            </div>
            <button onClick={copyId} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
          </div>
          {user?.username && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Username</div>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'Roboto Mono' }}>@{user.username}</div>
              </div>
              <button onClick={copyUsername} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SwapPopup({ onClose, cipherBalance, swapRate, swapMin, onSuccess }: { onClose: () => void; cipherBalance: number; swapRate: number; swapMin: number; onSuccess: () => void }) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const RATE = swapRate;
  const MIN_GOLD = swapMin;
  const parsed = parseInt(amount) || 0;
  const rounded = Math.floor(parsed);
  const axnOut = rounded / RATE;
  const canSwap = rounded >= MIN_GOLD && rounded <= cipherBalance;
  const maxAmount = Math.floor(cipherBalance);

  const handleSwap = async () => {
    if (!canSwap || loading) return;
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/convert-to-usd', { powAmount: rounded, convertTo: 'USD' });
      const data = await res.json();
      if (data.success) {
        showNotification(`✅ Swapped ${rounded.toLocaleString()} GOLD → $${axnOut.toFixed(4)} USDT`, 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        onSuccess();
        onClose();
      } else {
        showNotification(data.message || 'Swap failed', 'error');
      }
    } catch (e: any) {
      let msg = 'Swap failed';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setLoading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '100%', background: 'linear-gradient(160deg, #0d0d0f, #111118)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 44, height: 44, flexShrink: 0, objectFit: 'contain', display: 'block' }} />
          <div>
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 900 }}>Swap GOLD → USDT</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>{RATE.toLocaleString()} GOLD = 1 USDT</div>
          </div>
        </div>

        {/* Info rows */}
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '4px 0', marginBottom: 16 }}>
          {[
            { label: 'Your GOLD', val: cipherBalance.toLocaleString() },
            { label: 'Minimum', val: `${MIN_GOLD.toLocaleString()} GOLD` },
            { label: 'You receive', val: axnOut > 0 ? `$${axnOut.toFixed(4)} USDT` : '—' },
          ].map((r, i, arr) => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{r.label}</span>
                <span style={{ color: i === 2 && axnOut > 0 ? '#4ade80' : '#fff', fontSize: 13, fontWeight: 700 }}>{r.val}</span>
              </div>
              {i < arr.length - 1 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
            </div>
          ))}
        </div>

        {/* Amount input row */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Amount</div>
            <button onClick={() => setAmount(String(maxAmount))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 11, fontWeight: 700, padding: 0 }}>MAX</button>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={`Min ${MIN_GOLD.toLocaleString()}`}
              style={{ flex: 1, padding: '14px 0', background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 16, fontWeight: 700 }}
            />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 700 }}>GOLD</span>
          </div>
        </div>

        {/* Swap button */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || loading}
          style={{
            width: '100%', padding: '14px 0', border: 'none', borderRadius: 14,
            background: canSwap && !loading ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)' : 'rgba(255,255,255,0.06)',
            color: canSwap && !loading ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize: 14, fontWeight: 800, cursor: canSwap && !loading ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          className={canSwap && !loading ? 'active:scale-95 transition-transform' : ''}
        >
          {loading && <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
          {loading ? 'Swapping…' : canSwap ? `Swap ${rounded.toLocaleString()} GOLD → $${axnOut.toFixed(4)} USDT` : 'Enter an amount'}
        </button>
      </div>
    </div>
  );
}

function PromoPopup({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'watching-ad' | 'redeeming'>('idle');

  const handleRedeem = async () => {
    if (!code.trim()) { showNotification('Enter a promo code', 'error'); return; }
    if (loading) return;
    setLoading(true);

    try {
      setAdStep('redeeming');
      const res = await apiRequest('POST', '/api/promo-codes/redeem', { code: code.trim() });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || 'Promo code redeemed!', 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Invalid promo code', 'error');
      }
    } catch {
      showNotification('Failed to redeem. Try again.', 'error');
    } finally {
      setLoading(false);
      setAdStep('idle');
    }
  };

  const buttonLabel = adStep === 'redeeming' ? 'Redeeming...' : 'Redeem';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={!loading ? onClose : undefined} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Gift Code</span>
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            disabled={loading}
            style={{
              width: '100%', padding: '14px', borderRadius: 14,
              border: '1.5px solid rgba(61,21,128,0.24)',
              fontSize: 15, color: '#fff', letterSpacing: '0.08em', fontWeight: 700,
              background: 'rgba(255,255,255,0.04)', outline: 'none',
              boxSizing: 'border-box', textAlign: 'center',
              opacity: loading ? 0.5 : 1,
            }}
          />
        </div>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>A short ad plays before your reward is unlocked</p>
        <button
          onClick={handleRedeem}
          disabled={loading}
          style={{
            width: '100%', padding: '14px',
            background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
            border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
            fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 20px rgba(61,21,128,0.4)',
          }}
          className="active:scale-95 transition-transform"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
