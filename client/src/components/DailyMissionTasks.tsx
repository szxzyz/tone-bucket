import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";

function TaskIcon({ type, color }: { type: string; color: string }) {
  const id = `task-${type}`;
  return <div style={{ width: 46, height: 46, borderRadius: 15, background: `linear-gradient(145deg, ${color}32, ${color}0c)`, border: `1px solid ${color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 5px 16px ${color}20` }}>
    <svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="4" y1="4" x2="28" y2="28"><stop stopColor="#fff"/><stop offset="1" stopColor={color}/></linearGradient></defs>
      {type === "check" && <><rect x="6" y="7" width="20" height="20" rx="5" stroke={`url(#${id})`} strokeWidth="1.8"/><path d="M10 12h12M10 17h5M10 22h8" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round"/><path d="m22 18 .8 1.5 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.5.8.3-1.7-1.2-1.2 1.7-.2.7-1.5Z" fill={color}/></>}
      {type === "share" && <><path d="M11 16 21 10M11 16l10 6" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="16" r="4" stroke={`url(#${id})`} strokeWidth="1.8"/><circle cx="23" cy="8" r="4" stroke={`url(#${id})`} strokeWidth="1.8"/><circle cx="23" cy="24" r="4" stroke={`url(#${id})`} strokeWidth="1.8"/></>}
      {type === "bio" && <><path d="M13 19 11 21a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round"/><path d="m19 13 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round"/><path d="m11 16 10 0" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round"/></>}
      {type === "ads" && <><path d="M8 9.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3v-13Z" stroke={`url(#${id})`} strokeWidth="1.8"/><path d="m14 12 6 4-6 4v-8Z" fill={color}/><path d="M12 3v3M20 3v3" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round"/></>}
      {type === "starter" && <><path d="M7 12h18v13H7z" stroke={`url(#${id})`} strokeWidth="1.8"/><path d="M5 12h22v-3H5zM16 12v13" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinejoin="round"/><path d="M16 9c-5 1-7-1-6-3 1-2 5-1 6 3Zm0 0c5 1 7-1 6-3-1-2-5-1-6 3Z" stroke={`url(#${id})`} strokeWidth="1.5"/></>}
    </svg>
  </div>;
}

function TaskCard({ type, color, title, subtitle, buttonLabel, goldReward = 0, isCompleted, isClaimed, onAction, onClaim }: any) {
  return <div style={{ width: "100%", boxSizing: "border-box", borderRadius: 16, padding: 16, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", border: "1px solid rgba(255,255,255,.06)", boxShadow: "0 7px 20px rgba(0,0,0,.18)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <TaskIcon type={type} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>{title}</div>
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); isCompleted ? onClaim() : onAction(); }} disabled={isClaimed} style={{ background: isClaimed ? "rgba(255,255,255,.06)" : isCompleted ? "linear-gradient(135deg,#22c55e,#16a34a)" : `linear-gradient(135deg,${color},${color}b8)`, color: isClaimed ? "rgba(255,255,255,.3)" : "#fff", border: 0, minWidth: 68, height: 36, padding: "0 10px", borderRadius: 10, fontSize: 10.5, fontWeight: 900, cursor: isClaimed ? "not-allowed" : "pointer", flexShrink: 0, letterSpacing: ".03em" }}>{isClaimed ? "DONE" : isCompleted ? "CLAIM" : buttonLabel}</button>
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
    <TaskCard type="bio" color="#34d399" title="Put your referral link in your Telegram bio" buttonLabel="COPY" goldReward={missionStatus?.referralBio?.reward ?? 500} isCompleted={!!missionStatus?.referralBio?.completed} isClaimed={!!missionStatus?.referralBio?.claimed} onAction={copyBioLink} onClaim={() => claimMutation.mutate({ type: "referral_bio" })} />
    <TaskCard type="ads" color="#f59e0b" title="Watch 10 Video Ads" subtitle={`${missionStatus?.ads10?.progress ?? 0}/10 video ads watched today`} buttonLabel="WATCH" goldReward={missionStatus?.ads10?.reward ?? 100} isCompleted={!!missionStatus?.ads10?.completed} isClaimed={!!missionStatus?.ads10?.claimed} onAction={openAds} onClaim={() => claimMutation.mutate({ type: "ads_goal", goalType: "ads_10" })} />
    {starterTasks.length > 0 && <><div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px 0", color: "#c084fc", fontSize: 13, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Starter Tasks</div>{starterTasks.map((task: any) => <TaskCard key={task.id} type="starter" color="#c084fc" title={task.title} subtitle={task.subtitle || "Complete this official app task, then claim your reward."} buttonLabel="CLAIM" goldReward={task.rewardAmount} isCompleted={!task.claimed} isClaimed={task.claimed} onAction={() => { if (task.link) window.Telegram?.WebApp?.openTelegramLink ? window.Telegram.WebApp.openTelegramLink(task.link) : window.open(task.link, "_blank"); }} onClaim={() => starterClaim.mutate(task.id)} />)}</>}
  </div>;
}
