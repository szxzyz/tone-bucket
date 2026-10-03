import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";

function TaskIcon({ type }: { type: string }) {
  return <div style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {type === "check" && <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></>}
      {type === "share" && <><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="7.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="16.7"/></>}
      {type === "starter" && <><path d="M3 8h18v13H3z"/><path d="M1 8h22v-4H1zM12 8v13"/><path d="M12 4c-5 1-7-1-6-3 1-2 5-1 6 3Zm0 0c5 1 7-1 6-3-1-2-5-1-6 3Z"/></>}
    </svg>
  </div>;
}

function TaskCard({ type, color, title, subtitle, buttonLabel, goldReward = 0, isCompleted, isClaimed, onAction, onClaim }: any) {
  return <div style={{ width: "100%", boxSizing: "border-box", padding: "16px", background: "transparent", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <TaskIcon type={type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>{title}</div>
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); isCompleted ? onClaim() : onAction(); }} disabled={isClaimed} style={{ background: isClaimed ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)", color: isClaimed ? "rgba(255,255,255,0.3)" : "#fff", border: "none", width: 92, height: 38, padding: 0, borderRadius: 12, fontSize: 12, fontWeight: 800, cursor: isClaimed ? "not-allowed" : "pointer", flexShrink: 0, letterSpacing: "0.03em", whiteSpace: "nowrap", boxShadow: isClaimed ? "none" : "0 2px 12px rgba(37,99,235,0.4)" }}>{isClaimed ? "DONE" : isCompleted ? "CLAIM" : buttonLabel}</button>
    </div>
  </div>;
}

export default function DailyMissionTasks() {
  const queryClient = useQueryClient();
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300000, retry: false });
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });
  const { data: missionStatus } = useQuery<any>({ queryKey: ["/api/missions/status"], retry: false });
  const { data: starterData } = useQuery<any>({ queryKey: ["/api/starter-tasks"], retry: false });
  const claimMutation = useMutation({ mutationFn: async ({ type, goalType }: { type: string; goalType?: string }) => { const endpoint = type === "ads_goal" ? "/api/missions/ads-goal/claim" : `/api/missions/${type.replace(/_/g, "-")}/claim`; const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalType }), credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed to claim"); return d; }, onSuccess: d => { showNotification(d.message || "Reward claimed!", "success"); queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }); queryClient.invalidateQueries({ queryKey: ["/api/missions/status"] }); }, onError: (e: Error) => showNotification(e.message, "error") });
  const starterClaim = useMutation({ mutationFn: async (id: string) => { const r = await fetch(`/api/starter-tasks/${id}/claim`, { method: "POST", credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed to claim"); return d; }, onSuccess: d => { showNotification(d.message || "Starter reward claimed!", "success"); queryClient.invalidateQueries({ queryKey: ["/api/starter-tasks"] }); queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }); }, onError: (e: Error) => showNotification(e.message, "error") });
  const referralLink = user?.referralCode && appConfig?.botUsername ? `https://t.me/${String(appConfig.botUsername).replace(/^@/, "")}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : "";
  const copyBioLink = async () => { if (!referralLink) return showNotification("Referral link is not available yet", "error"); await navigator.clipboard.writeText(referralLink); showNotification("Referral link copied. Paste it in Telegram bio, save, then tap CLAIM.", "success"); };
  const openAds = () => { const el = document.querySelector("[data-ad-watching-section]"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); else showNotification("Open Watch Ads and watch 10 video ads.", "info"); };
  const openUpdates = () => { const url = appConfig?.updateUrl || appConfig?.channelUrl; if (!url) return showNotification("Update link is not configured yet", "error"); if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(url); else window.open(url, "_blank"); setTimeout(() => claimMutation.mutate({ type: "check_for_updates" }), 2000); };
  const shareFriends = async () => { try { const r = await fetch("/api/share/prepare-message", { method: "POST", credentials: "include" }); const d = await r.json(); if (d.success && window.Telegram?.WebApp?.shareMessage) window.Telegram.WebApp.shareMessage(d.messageId, (sent: boolean) => { if (sent) claimMutation.mutate({ type: "share_referral" }); }); else { const link = d.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(d.referralLink)}`; if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(link); else window.open(link, "_blank"); setTimeout(() => claimMutation.mutate({ type: "share_referral" }), 3000); } } catch { showNotification("Unable to prepare sharing", "error"); } };
  const starterTasks = starterData?.tasks || [];
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0 4px" }}>
    <TaskCard type="check" color="#38bdf8" title="Check for updates" buttonLabel="GO" goldReward={100} isCompleted={!!missionStatus?.checkForUpdates?.completed} isClaimed={!!missionStatus?.checkForUpdates?.claimed} onAction={openUpdates} onClaim={() => claimMutation.mutate({ type: "check_for_updates" })} />
    <TaskCard type="share" color="#a78bfa" title="Share With Friends" buttonLabel="SHARE" goldReward={100} isCompleted={!!missionStatus?.shareReferral?.completed} isClaimed={!!missionStatus?.shareReferral?.claimed} onAction={shareFriends} onClaim={() => claimMutation.mutate({ type: "share_referral" })} />
    {starterTasks.length > 0 && <><div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px 0", color: "#c084fc", fontSize: 13, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Starter Tasks</div>{starterTasks.map((task: any) => <TaskCard key={task.id} type="starter" color="#c084fc" title={task.title} subtitle={task.subtitle || "Complete this official app task, then claim your reward."} buttonLabel="CLAIM" goldReward={task.rewardAmount} isCompleted={!task.claimed} isClaimed={task.claimed} onAction={() => { if (task.link) window.Telegram?.WebApp?.openTelegramLink ? window.Telegram.WebApp.openTelegramLink(task.link) : window.open(task.link, "_blank"); }} onClaim={() => starterClaim.mutate(task.id)} />)}</>}
  </div>;
}
