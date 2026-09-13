import { Link, useLocation } from "wouter";
import { Gamepad2, Clapperboard, ListChecks } from "lucide-react";

const TABS = [
  { id: "game", label: "Game", path: "/game", icon: Gamepad2 },
  { id: "ads", label: "Ads", path: "/ads", icon: Clapperboard },
  { id: "mission", label: "Mission", path: "/mission", icon: ListChecks },
] as const;

export default function BottomNav() {
  const [location] = useLocation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#101012] border-t border-white/10 rounded-t-[28px]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <nav className="flex items-stretch justify-around w-full" style={{ height: "88px" }}>
        {TABS.map((tab) => {
          const on = location === tab.path || (tab.id === "ads" && location === "/");
          const Icon = tab.icon;
          return (
            <Link key={tab.id} href={tab.path} className="flex-1">
              <button className="w-full h-full flex flex-col items-center justify-center gap-1.5" aria-label={tab.label}>
                <Icon
                  className="w-7 h-7 transition-colors duration-150"
                  style={{ color: on ? "#ffffff" : "#6E6E73" }}
                  strokeWidth={on ? 2.5 : 2}
                />
                <span
                  className="text-[10.5px] font-medium leading-none tracking-wide transition-colors duration-150"
                  style={{ color: on ? "#ffffff" : "#6E6E73" }}
                >
                  {tab.label}
                </span>
              </button>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
