import { useEffect, useState } from "react";
import { ArrowDownToLine, HandCoins, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
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
  const { data: checkinStatus, isLoading: checkinLoading } = useQuery<any>({
    queryKey: ["/api/daily-checkin/status"],
    queryFn: async () => {
      const response = await fetch("/api/daily-checkin/status", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    retry: false,
  });

  // The daily check-in sheet opens automatically once the server confirms status.
  useEffect(() => {
    if (!checkinStatus || checkinShown) return;
    setCheckinShown(true);
    if (!checkinStatus.alreadyClaimedToday) setCheckinOpen(true);
  }, [checkinStatus, checkinShown]);

  const rawBalance = Number(user?.balance ?? 0);
  const balance = rawBalance < 1 ? Math.round(rawBalance * 10_000_000) : Math.floor(rawBalance);
  const tonBalance = Number(user?.tonBalance ?? 0);
  const alreadyClaimed = Boolean(checkinStatus?.alreadyClaimedToday);

  if (userLoading || checkinLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white/50 text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <section className="bg-[#141414] rounded-2xl p-4 border border-white/5 shadow-xl" aria-label="TON faucet balance">
          <div className="flex justify-between items-center mb-5">
            <span className="text-white/45 text-[10px] font-black uppercase tracking-[0.18em]">Faucet status</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-blue-400 text-[10px] font-black uppercase tracking-[0.18em]">Active</span>
            </div>
          </div>

          <div className="text-center py-4">
            <div className="text-white/40 text-[10px] font-black uppercase tracking-[0.16em] mb-3">Available balance</div>
            <div className="flex items-center justify-center gap-2">
              <img src="/assets/gems-icon.svg" alt="AXN" className="w-8 h-8 object-contain" />
              <span className="text-white text-4xl font-black tabular-nums tracking-tight">{formatBalance(balance)}</span>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 text-white/40 text-xs font-semibold tabular-nums">
              <TonIcon size={15} />
              <span>≈ {tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} TON</span>
            </div>
          </div>

          <div className="border-t border-white/5 pt-4 mt-2 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setLocation("/account")} className="w-full h-11 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-[#007AFF]/20 active:scale-[0.98] flex items-center justify-center gap-2">
              <ArrowDownToLine className="w-4 h-4" /> Withdraw
            </button>
            <button type="button" onClick={() => setCheckinOpen(true)} disabled={alreadyClaimed} className="w-full h-11 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-[#007AFF]/20 disabled:opacity-50 active:scale-[0.98] flex items-center justify-center gap-2">
              <HandCoins className="w-4 h-4" /> {alreadyClaimed ? "Claimed" : "Claim"}
            </button>
          </div>
        </section>

        <section className="mt-4 bg-[#141414] rounded-2xl p-4 border border-white/5" aria-label="Daily faucet reward">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-white text-sm font-black">Daily faucet reward</div>
              <div className="text-white/40 text-xs mt-1">{alreadyClaimed ? "Come back tomorrow for a new claim." : "Claim once every day to keep your streak."}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <img src="/assets/check-in.png" alt="Daily check-in" className="w-6 h-6 object-contain" />
            </div>
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
