import { FaMedal, FaTrophy } from "react-icons/fa";

type Props = {
  prizePool?: number | string | null;
  onClick: () => void;
};

export default function WeeklyContestBanner({ prizePool, onClick }: Props) {
  const parsedPrize = Number(prizePool ?? 10);
  const prizeLabel = Number.isFinite(parsedPrize) ? parsedPrize.toLocaleString() : "10";

  return (
    <button
      type="button"
      aria-label="Open weekly contest leaderboard"
      onClick={onClick}
      className="mt-3 mb-2 rounded-2xl overflow-hidden relative cursor-pointer active:scale-[0.99] transition-transform"
      style={{
        display: "block",
        width: "100%",
        height: 96,
        padding: 0,
        border: 0,
        background: "#111",
        textAlign: "left",
      }}
    >
      <img
        src="/weekly-contest-banner.jpg"
        alt=""
        aria-hidden="true"
        className="w-full h-full object-cover"
        style={{ objectPosition: "center 85%" }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0.15) 100%)" }}
      />
      <span className="absolute inset-0 flex items-center justify-between" style={{ padding: "0 14px" }}>
        <span className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <FaMedal style={{ color: "#FFD700", fontSize: 13 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FFD700", letterSpacing: "0.18em", textTransform: "uppercase", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
              Weekly Contest
            </span>
          </span>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#fff", letterSpacing: "-0.3px", textShadow: "0 2px 8px rgba(0,0,0,0.95)", lineHeight: 1.15 }}>
            Top Earners
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.75)", textShadow: "0 1px 4px rgba(0,0,0,0.9)", lineHeight: 1.2 }}>
            Take the prize
          </span>
        </span>
        <span className="flex flex-col items-center gap-0.5">
          <FaTrophy style={{ color: "#FFD700", fontSize: 22, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.8))" }} />
          <span style={{ fontSize: 20, fontWeight: 900, color: "rgba(180,180,180,0.9)", textShadow: "0 2px 6px rgba(0,0,0,0.9)", lineHeight: 1 }}>
            ${prizeLabel}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em" }}>
            Prize Pool
          </span>
        </span>
      </span>
    </button>
  );
}
