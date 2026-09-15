import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Bot, Send } from "lucide-react";
import { useLocation } from "wouter";
import AdvertiserTaskSheet from "@/components/AdvertiserTaskSheet";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";

export type AdvertiserTaskKind = "social" | "game";

interface UnifiedTask {
  id: string;
  type: "advertiser";
  taskType: string;
  title: string;
  link: string | null;
  rewardGold?: number;
  rewardGems?: number;
  rewardBUG?: number;
  rewardType: string;
  isAdminTask: boolean;
  isAdvertiserTask?: boolean;
  priority: number;
  verificationRequired?: boolean;
  channelVerified?: boolean;
  currentClicks?: number;
  totalClicksRequired?: number;
}

interface AdvertiserTaskFeedProps {
  kind: AdvertiserTaskKind;
  title: string;
  subtitle?: string;
  allowCreate?: boolean;
}

function openTaskLink(link: string | null) {
  if (!link) return;
  const url = link.trim().startsWith("http") ? link.trim() : `https://${link.trim()}`;
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openTelegramLink && url.includes("t.me/")) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
  else window.open(url, "_blank", "noopener,noreferrer");
}

function TaskAvatar({ link, isBot }: { link: string | null; isBot: boolean }) {
  const [imageOk, setImageOk] = React.useState(Boolean(link));
  const src = link ? `/api/advertiser-tasks/avatar?link=${encodeURIComponent(link)}` : "";

  return (
    <div style={{
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      overflow: "hidden", background: "rgba(37,99,235,0.12)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {imageOk && src ? (
        <img
          src={src}
          alt=""
          onError={() => setImageOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : isBot ? (
        <Bot style={{ width: 20, height: 20, color: "#3b82f6" }} />
      ) : (
        <Send style={{ width: 20, height: 20, color: "#3b82f6" }} />
      )}
    </div>
  );
}

function TaskCard({
  task,
  onGo,
  directPending,
  directReady,
  onClaimDirect,
}: {
  task: UnifiedTask;
  onGo: (task: UnifiedTask) => void;
  directPending?: boolean;
  directReady?: boolean;
  onClaimDirect?: () => void;
}) {
  const isBot = task.taskType === "bot";
  const reward = task.rewardGold ?? task.rewardGems ?? 0;
  const currentClicks = Math.max(0, task.currentClicks ?? 0);
  const totalClicks = Math.max(0, task.totalClicksRequired ?? 0);
  const limitReached = totalClicks > 0 && currentClicks >= totalClicks;

  return (
    <div
      onClick={() => onGo(task)}
      style={{ width: "100%", borderRadius: 18, overflow: "hidden", background: "#2B2B2B", cursor: "pointer" }}
      className="active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <TaskAvatar link={task.link} isBot={isBot} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.3, marginBottom: 2 }}>
            Sponsored by
          </p>
          <p className="text-white font-bold" style={{ fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {task.title}
          </p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
            Task Limit
          </p>
          <span style={{ fontSize: 13, fontWeight: 800, color: limitReached ? "rgba(239,68,68,0.85)" : "rgba(255,255,255,0.75)" }}>
            {currentClicks}<span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>/{totalClicks}</span>
          </span>
        </div>
      </div>

      <div style={{ padding: "0 12px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
            Reward
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <img src="/assets/cipher-icon.jpg" alt="CIPHER" style={{ width: 20, height: 20, objectFit: "contain", borderRadius: "50%" }} />
              <span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{reward.toLocaleString()}</span>
            </span>
          </div>
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (directReady && onClaimDirect) onClaimDirect();
            else if (!directPending) onGo(task);
          }}
          disabled={limitReached || directPending}
          style={{
            padding: "9px 16px", borderRadius: 18, minWidth: 92,
            fontSize: 12, fontWeight: 700, border: "none", cursor: limitReached || directPending ? "default" : "pointer",
            letterSpacing: "0.02em", whiteSpace: "nowrap",
            background: limitReached || directPending ? "rgba(255,255,255,0.06)" : directReady ? "#22c55e" : "#2563eb",
            color: limitReached || directPending ? "rgba(255,255,255,0.3)" : "#fff",
          }}
        >
          {limitReached ? "LIMIT" : directPending ? "WAIT 5s" : directReady ? "CLAIM" : "GET GOLD"}
        </button>
      </div>
    </div>
  );
}

export default function AdvertiserTaskFeed({ kind, title, subtitle, allowCreate = false }: AdvertiserTaskFeedProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = React.useState<UnifiedTask | null>(null);
  const [directTaskId, setDirectTaskId] = React.useState<string | null>(null);
  const [directClaimReady, setDirectClaimReady] = React.useState(false);
  const directTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskType = kind === "social" ? "channel" : "bot";

  const { data, isLoading } = useQuery<{ success: boolean; tasks: UnifiedTask[] }>({
    queryKey: ["/api/tasks/home/unified"],
    queryFn: async () => {
      const response = await fetch("/api/tasks/home/unified", { credentials: "include" });
      if (!response.ok) return { success: true, tasks: [] };
      return response.json();
    },
    retry: false,
  });

  const clickTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const clickResponse = await apiRequest("POST", `/api/advertiser-tasks/${taskId}/click`);
      const clickData = await clickResponse.json();
      if (!clickResponse.ok || !clickData.success) {
        throw new Error(clickData.message || "Task could not be opened.");
      }

      const claimResponse = await apiRequest("POST", `/api/advertiser-tasks/${taskId}/claim`);
      const claimData = await claimResponse.json();
      if (!claimResponse.ok || !claimData.success) {
        throw new Error(claimData.message || "Reward could not be claimed.");
      }
      return claimData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks/completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      showNotification("Task completed! Reward added to your balance.", "success");
      setActiveTask(null);
    },
    onError: (error: any) => showNotification(error?.message || "Task could not be completed.", "error"),
  });

  const tasks = (data?.tasks || []).filter((task) => task.taskType === taskType);

  React.useEffect(() => () => {
    if (directTimerRef.current) clearTimeout(directTimerRef.current);
  }, []);

  const handleTaskSelect = (task: UnifiedTask) => {
    // Non-verification tasks open directly. The task is not counted and no
    // reward is paid until the inline Claim button appears after five seconds.
    if (task.verificationRequired !== true) {
      openTaskLink(task.link);
      if (directTimerRef.current) clearTimeout(directTimerRef.current);
      setDirectTaskId(task.id);
      setDirectClaimReady(false);
      directTimerRef.current = setTimeout(() => setDirectClaimReady(true), 5_000);
      return;
    }
    setActiveTask(task);
  };

  const handleDirectClaim = (taskId: string) => {
    if (!directClaimReady || directTaskId !== taskId || clickTaskMutation.isPending) return;
    clickTaskMutation.mutate(taskId);
  };

  return (
    <section style={{ marginBottom: 10 }}>
      <div style={{ marginBottom: 8, paddingLeft: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 0 }}>{subtitle}</div>}
      </div>

      {allowCreate && (
        <button
          onClick={() => setLocation("/tasks/create")}
          style={{ width: "100%", padding: "12px", borderRadius: 18, background: "#2B2B2B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 14, fontWeight: 800, marginBottom: 10, border: "none" }}
          className="active:scale-[0.98] transition-transform"
        >
          <Plus size={18} color="#3b82f6" strokeWidth={3} />
          Add Your Task
        </button>
      )}

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}><Loader2 className="animate-spin text-white/20" /></div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 20px", background: "#171717", borderRadius: 14 }}>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>No {kind} tasks available.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onGo={handleTaskSelect}
              directPending={directTaskId === task.id && !directClaimReady}
              directReady={directTaskId === task.id && directClaimReady}
              onClaimDirect={() => handleDirectClaim(task.id)}
            />
          ))}
        </div>
      )}

      <AdvertiserTaskSheet
        open={!!activeTask}
        task={activeTask as any}
        reward={activeTask?.rewardGold ?? activeTask?.rewardGems ?? 0}
        onClose={() => setActiveTask(null)}
        onClaim={(id) => clickTaskMutation.mutate(id)}
        claiming={clickTaskMutation.isPending}
      />
    </section>
  );
}
