import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import ReferralContestSection from '@/components/ReferralContestSection';
import { formatLargeSWAG } from '@/lib/utils';

const FRIENDS_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const formatReward = (value: number) => Math.trunc(value).toLocaleString();
const formatWorthUsd = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;

export default function Affiliates() {
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const settingsLoaded = appSettings !== undefined;
  const joinReward = Math.max(0, Number(appSettings?.referralJoinRewardGold ?? 0) || 0);
  const activeReward = Math.max(0, Number(appSettings?.referralActiveRewardGold ?? 2500) || 0);
  const totalReward = joinReward + activeReward;
  const gemsPerUsd = Math.max(1, Number(appSettings?.padPerUsd ?? 100000) || 100000);
  const worthUsd = totalReward / gemsPerUsd;
  const commissionPercent = Math.max(0, Number(appSettings?.l1CommissionPercent ?? 5) || 0);
  const totalFriends = Number(stats?.totalInvites ?? 0);
  const activeFriends = Number(stats?.successfulInvites ?? 0);
  const totalEarned = Number(stats?.totalReferralBonusEarned || stats?.totalL1Earned || 0);

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-3 bg-black pb-0 text-white">
        <h1 className="text-white text-lg font-black mb-3 px-1">Friends</h1>

        <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <div className="text-white text-[15px] font-black mb-3">Per friend you invite</div>
          <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.045)' }}>
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <img src="/assets/gems-icon.svg" alt="GEM" className="w-7 h-7 object-contain shrink-0" />
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-white text-xl font-black tabular-nums truncate">{settingsLoaded ? formatReward(totalReward) : '…'}</span>
                  <span className="text-white text-xs font-extrabold uppercase tracking-wider shrink-0">GEM</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-white/45 text-[10px] font-bold uppercase tracking-wider">Worth</div>
                <div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded ? formatWorthUsd(worthUsd) : '…'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-3">
              {[
                ['On join', settingsLoaded ? `+${formatReward(joinReward)} GEM` : '…'],
                ['When active', settingsLoaded ? `+${formatReward(activeReward)} GEM` : '…'],
                ['Forever', settingsLoaded ? `${commissionPercent}% Commission` : '…'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl px-1.5 py-2 min-w-0" style={{ background: 'rgba(0,0,0,0.28)' }}>
                  <div className="text-white/45 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">{label}</div>
                  <div className="text-white text-xs font-black mt-1 whitespace-nowrap tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[14px] p-2 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Friends', totalFriends],
              ['Active', activeFriends],
              ['Earned GEM', formatLargeSWAG(totalEarned, false)],
            ].map(([label, value]) => (
              <div key={String(label)} className="text-center rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.045)' }}>
                <div className="text-white text-sm font-black tabular-nums truncate">{value}</div>
                <div className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-1 truncate">{label}</div>
              </div>
            ))}
          </div>
        </section>
        <ReferralContestSection />
        <div style={{ height: 104, flexShrink: 0 }} />
      </main>
    </Layout>
  );
}
