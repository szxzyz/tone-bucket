import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { useAuth } from "@/hooks/useAuth";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

const CARD = "#333333";
const TEXT_DIM = "rgba(255,255,255,0.35)";
const BLUE = "#00E676";
const GREEN = "#22c55e";

type Reward = {
  gold?: number;
  diamond?: number;
  ton?: number;
};

type QuestDefinition = {
  id: string;
  title: string;
  target: number;
  progressLabel: string;
  image: string;
  reward: Reward;
  kind: "checkin" | "ads" | "social" | "game" | "referral";
};

type ClaimableQuest = QuestDefinition & {
  progress: number;
  claimed?: boolean;
};

const QUEST_TARGETS = [10, 50, 100, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000, 20000, 25000, 30000, 50000];

const GAME_QUESTS: QuestDefinition[] = QUEST_TARGETS.map((target) => ({
  id: `game_${target}`,
  title: `Complete ${target.toLocaleString()} game tasks`,
  target,
  progressLabel: "Tasks completed",
  image: "/assets/quests.png",
  reward: { gold: target * 10, diamond: target / 10 },
  kind: "game",
}));

const CHECKIN_TARGETS = [
  [1, 100, 1], [5, 500, 5], [10, 1000, 10], [15, 3000, 30], [20, 5000, 50],
  [25, 10000, 100], [35, 20000, 200], [40, 30000, 300], [45, 50000, 500],
  [50, 100000, 1000], [55, 150000, 1500], [60, 200000, 2000], [75, 250000, 2500],
  [80, 300000, 3000], [85, 500000, 5000],
] as const;
const CHECKIN_QUESTS: QuestDefinition[] = CHECKIN_TARGETS.map(([target, gold, diamond]) => ({
  id: `checkin_${target}`,
  title: `Check-in for ${target} days`,
  target,
  progressLabel: "Days",
  image: "/assets/check-in.png",
  reward: { gold, diamond },
  kind: "checkin",
}));

const AD_QUESTS: QuestDefinition[] = QUEST_TARGETS.map((target) => ({
  id: `ads_${target}`,
  title: `Watch ${target.toLocaleString()} ads`,
  target,
  progressLabel: "Ads watched",
  image: "/assets/view-ads.png",
  reward: { gold: target * 10, diamond: target / 10 },
  kind: "ads",
}));

const SOCIAL_QUESTS: QuestDefinition[] = QUEST_TARGETS.map((target) => ({
  id: `social_${target}`,
  title: `Complete ${target.toLocaleString()} social tasks`,
  target,
  progressLabel: "Tasks completed",
  image: "/assets/tasks.png",
  reward: { gold: target * 10, diamond: target / 10 },
  kind: "social",
}));

const REFERRAL_QUESTS: QuestDefinition[] = QUEST_TARGETS.map((target) => ({
  id: `referral_${target}`,
  title: `Invite ${target.toLocaleString()} friends`,
  target,
  progressLabel: "Friends invited",
  image: "/assets/invite-milestone.png",
  reward: { gold: target * 10, diamond: target },
  kind: "referral",
}));

function formatProgress(value: number, target: number) {
  return `${Math.min(Math.max(value, 0), target).toLocaleString()}/${target.toLocaleString()}`;
}

function RewardValue({ reward }: { reward: Reward }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {reward.gold !== undefined && (
        <span className="inline-flex items-center gap-1 text-white text-base font-black">
          <img src="/assets/gold-icon.png" alt="Gold" style={{ width: 20, height: 20, objectFit: "contain" }} />
          {reward.gold.toLocaleString()}
        </span>
      )}
      {reward.diamond !== undefined && (
        <span className="inline-flex items-center gap-1 text-white text-base font-black">
          <img src="/assets/diamonds.png" alt="Diamond" style={{ width: 20, height: 20, objectFit: "contain" }} />
          {reward.diamond.toLocaleString()}
        </span>
      )}
      {reward.ton !== undefined && (
        <span className="inline-flex items-center gap-1 text-white text-base font-black">
          <span className="text-white/80 text-[13px] font-black">TON</span>
          {reward.ton.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      )}
    </div>
  );
}

function QuestCard({ quest, onClaim, claiming }: { quest: ClaimableQuest; onClaim: (quest: ClaimableQuest) => void; claiming: boolean }) {
  const reached = quest.progress >= quest.target;
  const claimed = Boolean(quest.claimed);
  const disabled = claiming || claimed || !reached;

  return (
    <div
      className="w-full rounded-[18px] overflow-hidden"
      style={{
        background: claimed ? "#111111" : CARD,
        opacity: claimed ? 0.68 : 1,
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <img src={quest.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 10, color: TEXT_DIM, lineHeight: 1.3, marginBottom: 2 }}>Quest</p>
          <p className="text-white font-bold" style={{ fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{quest.title}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {!claimed && (
            <>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{quest.progressLabel}</p>
              <span style={{ fontSize: 13, fontWeight: 800, color: reached ? GREEN : "rgba(255,255,255,0.75)" }}>{formatProgress(quest.progress, quest.target)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 pb-3 pt-0.5">
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Reward</p>
          <RewardValue reward={quest.reward} />
        </div>
        {claimed ? (
          <div
            aria-label="Claimed"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
            style={{ color: "#d68a2d" }}
          >
            <Check size={30} strokeWidth={3.5} />
          </div>
        ) : (
        <button
          type="button"
          onClick={() => onClaim(quest)}
          disabled={disabled}
          style={{
            padding: "9px 16px",
            borderRadius: 12,
            minWidth: 92,
            fontSize: 12,
            fontWeight: 700,
            border: "none",
            cursor: disabled ? "default" : "pointer",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            background: claimed || !reached ? "rgba(255,255,255,0.06)" : GREEN,
            color: claimed || !reached ? "rgba(255,255,255,0.3)" : "#fff",
          }}
        >
          {claiming ? "..." : reached ? "CLAIM" : "LOCKED"}
        </button>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
  collapsed,
  onToggle,
}: {
  title: string;
  subtitle: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-2" style={{ marginBottom: collapsed ? 0 : 6, paddingLeft: 2 }}>
      <div className="flex-1 min-w-0">
        <h2 className="text-white font-bold" style={{ fontSize: 16, lineHeight: 1.15, margin: 0 }}>{title}</h2>
        <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.2, margin: "2px 0 0" }}>{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
        style={{ background: "rgba(255,255,255,0.06)", border: "none", padding: 0 }}
      >
        {collapsed ? <ChevronDown size={16} strokeWidth={2.5} /> : <ChevronUp size={16} strokeWidth={2.5} />}
      </button>
    </div>
  );
}

export default function Quests() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: referralStats } = useQuery<any>({
    queryKey: ["/api/referrals/stats"],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data: questStatus } = useQuery<any>({
    queryKey: ["/api/quests/status"],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const [optimisticClaimedQuestIds, setOptimisticClaimedQuestIds] = useState<Set<string>>(() => new Set());
  const [optimisticClaimedReferralTargets, setOptimisticClaimedReferralTargets] = useState<Set<number>>(() => new Set());

  const referralClaim = useMutation({
    mutationFn: async (inviteTarget: number) => {
      const response = await apiRequest("POST", "/api/referrals/milestones/claim", { inviteTarget });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Unable to claim referral quest");
      return data;
    },
    onSuccess: (_data: any, inviteTarget: number) => {
      setOptimisticClaimedReferralTargets((current) => new Set(current).add(inviteTarget));
      queryClient.setQueryData<any>(["/api/referrals/stats"], (current: any) => {
        if (!current) return current;
        return {
          ...current,
          claimedMilestones: { ...(current.claimedMilestones ?? {}), [inviteTarget]: true },
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.refetchQueries({ queryKey: ["/api/referrals/stats"], type: "active" });
      showNotification("Referral reward claimed", "success");
    },
    onError: (error: any) => showNotification(error.message || "Unable to claim referral reward", "error"),
  });
  const genericClaim = useMutation({
    mutationFn: async (questId: string) => {
      const response = await apiRequest("POST", "/api/quests/claim", { questId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Unable to claim quest");
      return data;
    },
    onSuccess: (data: any, questId: string) => {
      const claimedId = String(data?.questId ?? questId);
      setOptimisticClaimedQuestIds((current) => new Set(current).add(claimedId));
      queryClient.setQueryData<any>(["/api/quests/status"], (current: any) => {
        if (!current) return { success: true, claimedQuestIds: [claimedId] };
        const claimedQuestIds = new Set<string>(current.claimedQuestIds ?? []);
        claimedQuestIds.add(claimedId);
        return { ...current, claimedQuestIds: Array.from(claimedQuestIds) };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.refetchQueries({ queryKey: ["/api/quests/status"], type: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/referrals/stats"] });
      showNotification("Quest reward claimed", "success");
    },
    onError: (error: any) => showNotification(error.message || "Unable to claim quest", "error"),
  });

  const goldEarned = Number(user?.totalEarned ?? user?.totalEarnedGold ?? 0);
  const adsWatched = Number(user?.adsWatched ?? 0);
  const referrals = Number(referralStats?.totalInvites ?? user?.friendsInvited ?? 0);
  const streak = Number(user?.dailyCheckinStreak ?? user?.currentStreak ?? questStatus?.streak ?? 0);
  const socialCompleted = Number(questStatus?.socialCompleted ?? 0);
  const claimedQuestIds = new Set<string>([
    ...(questStatus?.claimedQuestIds ?? []),
    ...optimisticClaimedQuestIds,
  ]);
  const claimedReferralMilestones = {
    ...(referralStats?.claimedMilestones ?? {}),
    ...Array.from(optimisticClaimedReferralTargets).reduce<Record<number, boolean>>((result, target) => {
      result[target] = true;
      return result;
    }, {}),
  };
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const buildQuests = (definitions: QuestDefinition[], progress: number): ClaimableQuest[] => definitions
    .map((quest) => ({
      ...quest,
      progress,
      claimed: quest.kind === "referral" ? Boolean(claimedReferralMilestones[quest.target]) : claimedQuestIds.has(quest.id),
    }))
    .filter((quest) => !quest.claimed);

  const sections = useMemo(() => [
    { title: "Daily Check-in quests", subtitle: "Maintain your daily streak.", quests: buildQuests(CHECKIN_QUESTS, streak) },
    { title: "Ad watch quests", subtitle: "Watch ads to boost rewards.", quests: buildQuests(AD_QUESTS, adsWatched) },
    { title: "Game quests", subtitle: "Complete game tasks and earn rewards.", quests: buildQuests(GAME_QUESTS, Number(questStatus?.gameCompleted ?? 0)) },
    { title: "Social quests", subtitle: "Follow and interact on social channels.", quests: buildQuests(SOCIAL_QUESTS, socialCompleted) },
    { title: "Referral quests", subtitle: "Invite friends and earn rewards.", quests: buildQuests(REFERRAL_QUESTS, referrals) },
  ], [adsWatched, claimedQuestIds, claimedReferralMilestones, goldEarned, referrals, socialCompleted, streak, questStatus?.gameCompleted, optimisticClaimedQuestIds, optimisticClaimedReferralTargets]);

  const handleClaim = (quest: ClaimableQuest) => {
    if (quest.kind === "referral") referralClaim.mutate(quest.target);
    else genericClaim.mutate(quest.id);
  };

  if (isLoading) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-white/30" /></div>;
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 bg-black text-white" style={{ paddingTop: 16, paddingBottom: 104 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 className="text-white font-black tracking-tight" style={{ fontSize: 25, lineHeight: 1.05, margin: 0 }}>Quests</h1>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 1.3, margin: "4px 0 0" }}>Complete quests and collect extra rewards.</p>
        </div>

        <div className="grid grid-cols-4 gap-2" style={{ marginBottom: 16 }}>
          {[
            ["Referrals", referrals.toLocaleString()],
            ["Gold earned", goldEarned.toLocaleString()],
            ["Ads watched", adsWatched.toLocaleString()],
            ["Streak", streak.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[14px] px-2 py-3 text-center" style={{ background: CARD }}>
              <div className="text-white font-extrabold" style={{ fontSize: 15, lineHeight: 1.1 }}>{value}</div>
              <div className="mt-1" style={{ color: TEXT_DIM, fontSize: 9, lineHeight: 1.15 }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {sections.filter((section) => section.quests.length > 0).map((section) => {
            const collapsed = Boolean(collapsedSections[section.title]);
            return (
              <section key={section.title}>
                <SectionHeading
                  title={section.title}
                  subtitle={section.subtitle}
                  collapsed={collapsed}
                  onToggle={() => setCollapsedSections((current) => ({ ...current, [section.title]: !current[section.title] }))}
                />
                {!collapsed && (
                  <div className="space-y-2">
                    {section.quests.map((quest) => (
                      <QuestCard
                        key={quest.id}
                        quest={quest}
                        onClaim={handleClaim}
                        claiming={quest.kind === "referral" ? referralClaim.isPending : genericClaim.isPending}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {sections.every((section) => section.quests.length === 0) && (
            <div className="rounded-[18px] px-4 py-8 text-center" style={{ background: CARD }}>
              <p className="text-white font-bold" style={{ fontSize: 15 }}>All quests completed</p>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 1.4, marginTop: 5 }}>
                New quests will appear here when they become available.
              </p>
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
}
