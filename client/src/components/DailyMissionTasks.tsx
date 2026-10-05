import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";

function TaskIcon({ type }: { type: string }) {
  return <div style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {type === "check" && <><path d="M20 11a8 8 0 0 0-14.7-4L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4L21 15"/><path d="M21 20v-5h-5"/><circle cx="12" cy="12" r="1.2" fill="rgba(255,255,255,0.7)" stroke="none"/></>}
      {type === "share" && <><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="7.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="16.7"/></>}
      {type === "starter" && <><path d="M3 8h18v13H3z"/><path d="M1 8h22v-4H1zM12 8v13"/><path d="M12 4c-5 1-7-1-6-3 1-2 5-1 6 3Zm0 0c5 1 7-1 6-3-1-2-5-1-6 3Z"/></>}
    </svg>
  </div>;
}

function TaskCard({ type, color, title, subtitle, buttonLabel, goldReward = 0, isCompleted, isClaimed, isBusy = false, onAction, onClaim }: any) {
  return <div style={{ width: "100%", boxSizing: "border-box", padding: "16px", background: "transparent", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <TaskIcon type={type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>{title}</div>
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); isCompleted ? onClaim() : onAction(); }} disabled={isClaimed || isBusy} style={{ background: isClaimed || isBusy ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)", color: isClaimed || isBusy ? "rgba(255,255,255,0.3)" : "#fff", border: "none", width: 92, height: 38, padding: 0, borderRadius: 12, fontSize: 12, fontWeight: 800, cursor: isClaimed || isBusy ? "not-allowed" : "pointer", flexShrink: 0, letterSpacing: "0.03em", whiteSpace: "nowrap", boxShadow: isClaimed || isBusy ? "none" : "0 2px 12px rgba(37,99,235,0.4)" }}>{isClaimed ? "DONE" : isBusy ? "..." : isCompleted ? "CLAIM" : buttonLabel}</button>
    </div>
  </div>;
}

export default function DailyMissionTasks() {
  const queryClient = useQueryClient();
  const [sharing, setSharing] = useState(false);
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300000, retry: false });
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });
  const { data: missionStatus } = useQuery<any>({ queryKey: ["/api/missions/status"], retry: false });
  const claimMutation = useMutation({ mutationFn: async ({ type, goalType }: { type: string; goalType?: string }) => { const endpoint = type === "ads_goal" ? "/api/missions/ads-goal/claim" : `/api/missions/${type.replace(/_/g, "-")}/claim`; const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalType }), credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed to claim"); return d; }, onSuccess: d => { showNotification(d.message || "Reward claimed!", "success"); queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }); queryClient.invalidateQueries({ queryKey: ["/api/missions/status"] }); }, onError: (e: Error) => showNotification(e.message, "error") });
  const referralLink = user?.referralCode && appConfig?.botUsername ? `https://t.me/${String(appConfig.botUsername).replace(/^@/, "")}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : "";
  const copyBioLink = async () => { if (!referralLink) return showNotification("Referral link is not available yet", "error"); await navigator.clipboard.writeText(referralLink); showNotification("Referral link copied. Paste it in Telegram bio, save, then tap CLAIM.", "success"); };
  const openAds = () => { const el = document.querySelector("[data-ad-watching-section]"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); else showNotification("Open Watch Ads and watch 10 video ads.", "info"); };
  const openUpdates = () => { const url = appConfig?.updateUrl || appConfig?.channelUrl; if (!url) return showNotification("Update link is not configured yet", "error"); if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(url); else window.open(url, "_blank"); setTimeout(() => claimMutation.mutate({ type: "check_for_updates" }), 2000); };
  const shareFriends = async () => {
    if (sharing || claimMutation.isPending) return;
    setSharing(true);
    const finishClaim = () => claimMutation.mutate({ type: "share_referral" }, { onSettled: () => setSharing(false) });
    try {
      const r = await fetch("/api/share/prepare-message", { method: "POST", credentials: "include" });
      const d = await r.json();
      if (d.success && window.Telegram?.WebApp?.shareMessage) {
        window.Telegram.WebApp.shareMessage(d.messageId, (sent: boolean) => sent ? finishClaim() : setSharing(false));
      } else {
        const link = d.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(d.referralLink)}`;
        if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(link); else window.open(link, "_blank");
        setTimeout(finishClaim, 3000);
      }
    } catch {
      setSharing(false);
      showNotification("Unable to prepare sharing", "error");
    }
  };
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0 4px" }}>
    <TaskCard type="check" color="#38bdf8" title="Check for updates" buttonLabel="GO" goldReward={100} isCompleted={!!missionStatus?.checkForUpdates?.completed} isClaimed={!!missionStatus?.checkForUpdates?.claimed} onAction={openUpdates} onClaim={() => claimMutation.mutate({ type: "check_for_updates" })} />
    <TaskCard type="share" color="#a78bfa" title="Share With Friends" buttonLabel="SHARE" goldReward={100} isCompleted={!!missionStatus?.shareReferral?.completed} isClaimed={!!missionStatus?.shareReferral?.claimed} isBusy={sharing || claimMutation.isPending} onAction={shareFriends} onClaim={() => claimMutation.mutate({ type: "share_referral" })} />

  </div>;
}


export function StarterTasksSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["/api/starter-tasks"], retry: false });
  const starterClaim = useMutation({ mutationFn: async (id: string) => { const r = await fetch(`/api/starter-tasks/${id}/claim`, { method: "POST", credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed to claim"); return d; }, onSuccess: d => { showNotification(d.message || "Starter reward claimed!", "success"); queryClient.invalidateQueries({ queryKey: ["/api/starter-tasks"] }); queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }); }, onError: (e: Error) => showNotification(e.message, "error") });
  const tasks = data?.tasks || [];
  if (!tasks.length) return null;
  return <section style={{ width: "100%", borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,0.25)" }}>
    <div style={{ padding: "16px 16px 4px", color: "#fff", fontSize: 15, fontWeight: 800 }}>Starter Tasks</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {tasks.map((task: any) => <TaskCard key={task.id} type="starter" title={task.title} buttonLabel="CLAIM" isCompleted={!task.claimed} isClaimed={task.claimed} onAction={() => { if (task.link) window.Telegram?.WebApp?.openTelegramLink ? window.Telegram.WebApp.openTelegramLink(task.link) : window.open(task.link, "_blank"); }} onClaim={() => starterClaim.mutate(task.id)} />)}
    </div>
  </section>;
}
