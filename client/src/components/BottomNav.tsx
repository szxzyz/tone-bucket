import { useLocation } from "wouter";
import { Trophy, Video } from "lucide-react";

const ACTIVE = "#ffffff";
const DIM = "rgba(255,255,255,0.38)";

const TasksIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="16" rx="3" fill={active ? c : "none"} opacity={active ? 0.15 : 1} stroke={c} strokeWidth="1.8" />
    <path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const FriendsIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="25" height="25" viewBox="0 0 24 24" fill="none">
    <path d="M12 3.2 14.1 8l5.2.55-3.9 3.5 1.1 5.1L12 14.5l-4.5 2.65 1.1-5.1-3.9-3.5L9.9 8 12 3.2Z" fill={active ? c : "none"} opacity={active ? 0.16 : 1} stroke={c} strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M4 19.5c1.1-1.5 2.6-2.25 4.5-2.25M20 19.5c-1.1-1.5-2.6-2.25-4.5-2.25" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="4" cy="19.5" r="1.2" fill={c} />
    <circle cx="20" cy="19.5" r="1.2" fill={c} />
  </svg>
);

const TABS = [
  { id: "mission", label: "Mission", path: "/mission" },
  { id: "ads", label: "Ads", path: "/ads" },
  { id: "leaderboard", label: "Leaderboard", path: "/leaderboard" },
  { id: "friends", label: "Friends", path: "/affiliates" },
] as const;

export default function BottomNav() {
  const [location, setLocation] = useLocation();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 600,
        display: "flex",
        alignItems: "stretch",
        height: 72,
        paddingBottom: "max(var(--tg-content-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 6px)",
        background: "#0a0a0a",
      }}
      aria-label="Main navigation"
    >
      {TABS.map((tab) => {
        const active = location === tab.path
          || (tab.id === "mission" && ["/", "/game", "/machine"].includes(location));
        const color = active ? ACTIVE : DIM;

        return (
          <button
            key={tab.id}
            onClick={() => setLocation(tab.path)}
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              height: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              position: "relative",
              padding: "6px 0 4px",
            }}
          >
            {active && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: "25%",
                  right: "25%",
                  height: 2,
                  borderRadius: "0 0 3px 3px",
                  background: ACTIVE,
                }}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: 28 }}>
              {tab.id === "mission" ? <TasksIcon active={active} c={color} />
                : tab.id === "friends" ? <FriendsIcon active={active} c={color} />
                : tab.id === "ads" ? <Video size={21} color={color} strokeWidth={active ? 2.2 : 1.8} />
                : <Trophy size={21} color={color} strokeWidth={active ? 2.2 : 1.8} />}
            </div>
            <span style={{ fontSize: "clamp(7px, 2.2vw, 9px)", fontWeight: active ? 700 : 500, letterSpacing: 0, color, lineHeight: 1, whiteSpace: "nowrap" }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
