import { ArrowRight } from "lucide-react";
import { FaMedal } from "react-icons/fa";

type Props = { onClick: () => void };

export default function DailyContestBanner({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Top Inviter: Invite friends and climb the referral leaderboard"
      className="mt-[18px] block w-full overflow-hidden relative rounded-2xl active:scale-[0.99] transition-transform"
      style={{
        maxWidth: 680,
        height: 106,
        marginLeft: "auto",
        marginRight: "auto",
        padding: 0,
        border: 0,
        background: "#111",
        textAlign: "left",
      }}
    >
      <img
        src="/daily-contest-banner.jpg"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 55%" }}
      />
      <span
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 48%, rgba(0,0,0,0.12) 100%)" }}
      />
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#FFD700", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
            <FaMedal aria-hidden="true" />
            Top Inviter
          </span>
          <span style={{ color: "#fff", fontSize: 17, lineHeight: 1.1, fontWeight: 900, textShadow: "0 2px 8px rgba(0,0,0,0.95)" }}>
            Invite friends
          </span>
          <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 11, lineHeight: 1.2, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
            Climb the referral leaderboard
          </span>
        </span>
        <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 8 }}>
          <ArrowRight size={22} color="#fff" strokeWidth={2.5} />
        </span>
      </span>
    </button>
  );
}
