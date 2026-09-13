import { useLocation } from "wouter";
import { Home, Clapperboard, ListChecks, Users } from "lucide-react";

const TABS = [
  { id: "home", label: "Home", path: "/", icon: Home },
  { id: "ads", label: "Rewards", path: "/ads", icon: Clapperboard },
  { id: "mission", label: "Farming", path: "/mission", icon: ListChecks },
  { id: "friend", label: "Friends", path: "/friend", icon: Users },
] as const;

export default function BottomNav() {
  const [location, setLocation] = useLocation();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-white/[0.07]" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }}>
      <nav className="flex items-stretch justify-around w-full" style={{ height: "72px" }} aria-label="Main navigation">
        {TABS.map((tab) => {
          const on = tab.id === "home" ? location === "/" || location === "/home" : location === tab.path;
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setLocation(tab.path)} className="flex-1 h-full flex flex-col items-center justify-center gap-1.5 relative" aria-label={tab.label}>
              {on && <span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full bg-purple-500" />}
                <Icon
                  className="w-[21px] h-[21px] transition-colors duration-150"
                  style={{ color: on ? "#ffffff" : "#6E6E73" }}
                  strokeWidth={on ? 2.5 : 2}
                />
                <span
                  className="text-[10px] leading-none tracking-wide transition-colors duration-150"
                  style={{ color: on ? "#ffffff" : "#6E6E73" }}
                >
                  {tab.label}
                </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
