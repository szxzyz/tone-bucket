import { useLocation } from "wouter";
import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import GameHeader from "@/components/GameHeader";
import GameMenuPopup from "@/components/GameMenuPopup";
import GameWithdrawPopup from "@/components/GameWithdrawPopup";
import { useSeasonEnd } from "@/lib/SeasonEndContext";
import BanScreen from "@/components/BanScreen";
import BottomNav from "@/components/BottomNav";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { isConnected } = useWebSocket();
  const { showSeasonEnd } = useSeasonEnd();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  if (user?.banned) {
    return <BanScreen reason={user.bannedReason} />;
  }
  const rawBalance = Number.parseFloat(String(user?.balance ?? user?.walletBalance ?? "0"));
  const userBalance = Number.isFinite(rawBalance)
    ? Math.floor(rawBalance < 1 ? rawBalance * 10_000_000 : rawBalance)
    : 0;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#0f0f0f] overflow-hidden">
      {/* Fixed header — always visible on all pages */}
      <GameHeader onMenuOpen={() => setMenuOpen(true)} />

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)", // Removed extra bottom padding to prevent over-scrolling
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
      {menuOpen && (
        <GameMenuPopup
          onClose={() => setMenuOpen(false)}
          onWithdraw={() => {
            setMenuOpen(false);
            setWithdrawOpen(true);
          }}
        />
      )}
      <GameWithdrawPopup
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        userBalance={userBalance}
      />
    </div>
  );
}
