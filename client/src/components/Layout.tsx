import { useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import GameHeader from "@/components/GameHeader";
import { useSeasonEnd } from "@/lib/SeasonEndContext";
import BanScreen from "@/components/BanScreen";
import BottomNav from "@/components/BottomNav";

interface LayoutProps {
  children: React.ReactNode;
  onAddTask?: () => void;
}

export default function Layout({ children, onAddTask }: LayoutProps) {
  const [location] = useLocation();
  const { isConnected } = useWebSocket();
  const { showSeasonEnd } = useSeasonEnd();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  if (user?.banned) {
    return <BanScreen reason={user.bannedReason} />;
  }
  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#0f0f0f] overflow-hidden">
      {/* Fixed header — always visible on all pages */}
      <GameHeader onAddTask={onAddTask} />

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)", // Keep the shared layout unchanged for all pages
          paddingTop: "var(--header-height, 56px)",
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{
              duration: 0.22,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {!showSeasonEnd && <BottomNav />}
    </div>
  );
}
