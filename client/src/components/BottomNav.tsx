import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Home as HomeIcon, HeartHandshake, ListChecks, ShieldCheck, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ACTIVE = "#ffffff";
const DIM = "#6E6E73";

const TABS = [
  { id: "rewards", label: "Home",    path: "/rewards", icon: HomeIcon       },
  { id: "quests",  label: "Quests",  path: "/quests",  icon: ListChecks     },
  { id: "friend",  label: "Friends", path: "/friend",  icon: HeartHandshake },
  { id: "withdraw", label: "Withdraw", path: "/withdraw", icon: Wallet       },
] as const;

export default function BottomNav() {
  const [location, setLocation] = useLocation();
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [adminFlash, setAdminFlash] = useState(false);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const isOn = (tab: typeof TABS[number]) =>
    location === tab.path ||
    (tab.id === "quests" && location.startsWith("/quests")) ||
    (tab.id === "rewards" && (location === "/" || location.startsWith("/rewards")));

  const telegramPhotoUrl =
    typeof window !== "undefined" &&
    (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl =
    telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;

  const handleHomeClick = () => {
    if (location !== "/rewards" && location !== "/") setLocation("/rewards");
  };

  const handleHomeDoubleClick = () => {
    setAdminFlash(true);
    setTimeout(() => setAdminFlash(false), 800);
    setLocation("/admin");
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#333333] border-t border-white/10 rounded-t-[28px]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <nav className="flex items-stretch justify-around w-full" style={{ height: "88px" }}>
        {TABS.map((tab) => {
          const on = isOn(tab);
          const Icon = tab.icon;

          if (tab.id === "rewards") {
            return (
              <button
                key={tab.id}
                onClick={handleHomeClick}
                onDoubleClick={handleHomeDoubleClick}
                className="flex-1 flex flex-col items-center justify-center gap-1.5"
                aria-label="Home"
              >
                <div className="relative w-7 h-7 rounded-full flex items-center justify-center">
                  <AnimatePresence>
                    {adminFlash && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.3 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="absolute inset-0 -m-1 rounded-full flex items-center justify-center z-10 bg-[#1C1C1E]"
                      >
                        <ShieldCheck className="w-5 h-5" style={{ color: "#ffffff", strokeWidth: 2 }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {(!photoLoaded || photoError) && !adminFlash && (
                    <HomeIcon
                      className="w-7 h-7"
                      style={{ color: on || location.startsWith("/admin") ? "#ffffff" : "#6E6E73" }}
                      strokeWidth={on || location.startsWith("/admin") ? 2.5 : 2}
                    />
                  )}
                  {userPhotoUrl && !photoError && (
                    <img
                      src={userPhotoUrl}
                      alt="Profile"
                      onLoad={() => setPhotoLoaded(true)}
                      onError={() => {
                        setPhotoError(true);
                        setPhotoLoaded(false);
                      }}
                      className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-200 ${
                        photoLoaded ? "opacity-100" : "opacity-0"
                      } ${on || location.startsWith("/admin") ? "ring-2 ring-white" : "ring-1 ring-white/20"}`}
                    />
                  )}
                </div>
                <span
                  className="text-[10.5px] font-medium leading-none tracking-wide transition-colors duration-150"
                  style={{ color: on || location.startsWith("/admin") ? "#ffffff" : "#6E6E73" }}
                >
                  {tab.label}
                </span>
              </button>
            );
          }

          return (
            <Link key={tab.id} href={tab.path} className="flex-1">
              <button className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                <div className="relative">
                  <Icon
                    className="w-7 h-7 transition-colors duration-150"
                    style={{ color: on ? "#ffffff" : "#6E6E73" }}
                    strokeWidth={on ? 2.5 : 2}
                  />
                </div>
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
