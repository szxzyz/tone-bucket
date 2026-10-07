import { useLocation } from "wouter";
import { useLanguage } from "@/hooks/useLanguage";
import { useAdmin } from "@/hooks/useAdmin";

const ACTIVE = "#ffffff";
const DIM = "rgba(255,255,255,0.38)";

const HomeIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="29" height="29" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m3.5 10.5 8.5-7 8.5 7" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 9.5v10h13v-10" fill={active ? c : "none"} opacity={active ? 0.14 : 1} stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M9.5 19.5v-5h5v5" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const TasksIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="29" height="29" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="16" rx="3" fill={active ? c : "none"} opacity={active ? 0.15 : 1} stroke={c} strokeWidth="1.8" />
    <path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const FriendsIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="29" height="29" viewBox="0 0 24 24" fill="none">
    <path d="M12 3.2 14.1 8l5.2.55-3.9 3.5 1.1 5.1L12 14.5l-4.5 2.65 1.1-5.1-3.9-3.5L9.9 8 12 3.2Z" fill={active ? c : "none"} opacity={active ? 0.16 : 1} stroke={c} strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M4 19.5c1.1-1.5 2.6-2.25 4.5-2.25M20 19.5c-1.1-1.5-2.6-2.25-4.5-2.25" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="4" cy="19.5" r="1.2" fill={c} />
    <circle cx="20" cy="19.5" r="1.2" fill={c} />
  </svg>
);

const AccountIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="29" height="29" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" fill={active ? c : "none"} opacity={active ? 0.14 : 1} stroke={c} strokeWidth="1.7" />
    <circle cx="12" cy="9" r="2.6" fill={active ? c : "none"} stroke={c} strokeWidth="1.6" />
    <path d="M6.9 18.1c.7-2.3 2.5-3.6 5.1-3.6s4.4 1.3 5.1 3.6" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const TABS = [
  { id: "home", key: "nav_home", path: "/" },
  { id: "mission", key: "nav_mission", path: "/mission" },
  { id: "friends", key: "nav_friends", path: "/affiliates" },
  { id: "account", key: "nav_account", path: "/account" },
] as const;

export default function BottomNav() {
  const [location, setLocation] = useLocation();
  const { t } = useLanguage();
  const { isAdmin } = useAdmin();
  const visibleTabs = isAdmin ? TABS : TABS.filter((tab) => tab.id !== "home");
  const labels = visibleTabs.map((tab) => ({ ...tab, label: t(tab.key) }));

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
        height: 76,
        paddingBottom: "max(var(--tg-content-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 6px)",
        background: "#0a0a0a",
      }}
      aria-label="Main navigation"
    >
      {labels.map((tab) => {
        const active = (tab.id === "mission" && ["/game", "/machine"].includes(location)) || location === tab.path;
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
              gap: 4,
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: 34 }}>
              {tab.id === "home" ? <HomeIcon active={active} c={color} />
                : tab.id === "mission" ? <TasksIcon active={active} c={color} />
                : tab.id === "friends" ? <FriendsIcon active={active} c={color} />
                : <AccountIcon active={active} c={color} />}
            </div>
            <span style={{ fontSize: "clamp(10px, 2.7vw, 11px)", fontWeight: active ? 700 : 500, letterSpacing: 0, color, lineHeight: 1, whiteSpace: "nowrap" }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
