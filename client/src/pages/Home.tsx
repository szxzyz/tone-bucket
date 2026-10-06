import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import GameFarmingSection from "@/components/GameFarmingSection";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { TonIcon } from "@/components/TonIcon";

function formatBalance(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinShown, setCheckinShown] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });
  const { data: appConfig } = useQuery<any>({
    queryKey: ["/api/config/app"],
    staleTime: 300_000,
    retry: false,
  });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ["/api/daily-checkin/status"],
    queryFn: async () => {
      const response = await fetch("/api/daily-checkin/status", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (!checkinStatus || checkinShown) return;
    setCheckinShown(true);
    if (!checkinStatus.alreadyClaimedToday) setCheckinOpen(true);
  }, [checkinStatus, checkinShown]);

  const rawBalance = Number(user?.balance ?? 0);
  const balance = rawBalance < 1 ? Math.round(rawBalance * 10_000_000) : Math.floor(rawBalance);
  const tonBalance = Number(user?.tonBalance ?? 0);
  const alreadyClaimed = Boolean(checkinStatus?.alreadyClaimedToday);

  if (userLoading) {
    return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-white/50 text-sm">Loading…</div>;
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <section className="bg-[#141414] rounded-2xl p-4 border border-white/5 shadow-xl" aria-label="GRM balance">
          <div className="flex justify-between items-center mb-5">
            <span className="text-white/45 text-[10px] font-black uppercase tracking-[0.18em]">Available balance</span>
            <span className="text-blue-400 text-[10px] font-black uppercase tracking-[0.18em]">GRM</span>
          </div>
          <div className="text-center py-3">
            <div className="flex items-center justify-center gap-2">
              <img src="/assets/gems-icon.svg" alt="GRM" className="w-8 h-8 object-contain" />
              <span className="text-white text-4xl font-black tabular-nums tracking-tight">{formatBalance(balance)}</span>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 text-white/40 text-xs font-semibold tabular-nums">
              <TonIcon size={15} />
              <span>≈ {tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} TON</span>
            </div>
          </div>
          <div className="border-t border-white/5 pt-4 mt-2">
            <button type="button" onClick={() => setLocation("/account")} className="w-full h-11 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-[#007AFF]/20 active:scale-[0.98] flex items-center justify-center gap-2">
              <ArrowDownToLine className="w-4 h-4" /> Withdraw
            </button>
          </div>
        </section>

        <GameFarmingSection />

        <section className="bg-[#141414] rounded-2xl p-4 border border-white/5" aria-label="Daily check-in">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-white text-sm font-black">Daily check-in</div>
              <div className="text-white/40 text-xs mt-1">{alreadyClaimed ? "Reward claimed today. Come back tomorrow." : "Keep your streak active and earn daily GRM."}</div>
            </div>
            <button type="button" onClick={() => setCheckinOpen(true)} disabled={alreadyClaimed} className="h-9 px-4 rounded-xl bg-[#007AFF] text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40 active:scale-95 transition-transform">
              {alreadyClaimed ? "Done" : "Check"}
            </button>
          </div>
        </section>
      </main>

      <DailyCheckinSheet
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={alreadyClaimed}
        adsgramBlockId={appConfig?.adsgramCheckinBlockId || ""}
        onClaimed={() => {
          setCheckinOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/daily-checkin/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        }}
      />
    </Layout>
  );
}
