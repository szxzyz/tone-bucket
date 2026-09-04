import Layout from "@/components/Layout";
import AdWatchingSection from "@/components/AdWatchingSection";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useLanguage } from "@/hooks/useLanguage";
import { FaTrophy, FaMedal } from "react-icons/fa";

export default function Earn() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1 justify-center mb-4">
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <div className="text-foreground font-medium">{t('loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto bg-black text-white flex flex-col h-full overflow-hidden relative">
        {/* Fixed Header Part (Banner + Title) */}
        <div 
          className="px-4 pt-2 shrink-0 bg-black z-10 w-full"
          style={{ 
            position: 'sticky', 
            top: 0,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}
        >
          {/* Weekly Contest Banner */}
          <div
            className="mt-1 mb-4 rounded-2xl overflow-hidden relative cursor-pointer"
            style={{ height: 'clamp(80px, 12vh, 96px)' }}
            onClick={() => setLocation('/leaderboard')}
          >
          <img
            src="/daily-contest-banner.jpg"
            alt="Weekly Contest"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center' }}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0.15) 100%)' }} />
          <div className="absolute inset-0 flex items-center justify-between" style={{ padding: '0 14px' }}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <FaMedal style={{ color: '#FFD700', fontSize: 13 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#FFD700', letterSpacing: '0.18em', textTransform: 'uppercase', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                  {t('weekly_contest')}
                </span>
              </div>
              <span style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px', textShadow: '0 2px 8px rgba(0,0,0,0.95)', lineHeight: 1.15 }}>
                {t('top_earners')}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', lineHeight: 1.2 }}>
                {t('take_the_prize')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <FaTrophy style={{ color: '#FFD700', fontSize: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }} />
              <span style={{ fontSize: 20, fontWeight: 900, color: 'rgba(180,180,180,0.9)', textShadow: '0 2px 6px rgba(0,0,0,0.9)', lineHeight: 1 }}>
                {appSettings?.weeklyGiveawayAmount ?? 10} TON
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em' }}>
                {t('prize_pool')}
              </span>
            </div>
          </div>
        </div>

          {/* Viewing Ads Title (Fixed) */}
          <div className="mb-3 text-center">
            <h2 className="text-[15px] font-extrabold text-white tracking-widest uppercase mb-0.5">
              {t("viewing_ads")}
            </h2>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
              {t("get_paid_viewing_ads")}
            </p>
          </div>
        </div>

        {/* Scrollable Content (Ad Cards) */}
        <div className="flex-1 overflow-y-auto px-4 custom-scrollbar" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 80px) + 20px)' }}>
          <AdWatchingSection user={user} hideTitle={true} />
        </div>
      </main>
    </Layout>
  );
}
