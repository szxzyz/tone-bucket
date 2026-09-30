import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FaMedal, FaTrophy } from "react-icons/fa";

type LeaderboardTab = "monthly" | "referral";
type Props = {
  prizePool?: number | string | null;
  onSelect: (tab: LeaderboardTab) => void;
};

type SlideProps = {
  image: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  rightContent: ReactNode;
  imagePosition?: string;
};

function ContestSlide({ image, eyebrow, title, subtitle, onClick, rightContent, imagePosition = "center" }: SlideProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${eyebrow}: ${title}`}
      className="contest-banner-slide relative overflow-hidden rounded-2xl active:scale-[0.99] transition-transform"
      style={{
        position: "relative",
        display: "block",
        flex: "0 0 min(88%, 460px)",
        height: 106,
        minWidth: 0,
        padding: 0,
        border: 0,
        background: "#111",
        textAlign: "left",
        scrollSnapAlign: "start",
      }}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: imagePosition }}
      />
      <span
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 48%, rgba(0,0,0,0.12) 100%)" }}
      />
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#FFD700", fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
            <FaMedal aria-hidden="true" />
            {eyebrow}
          </span>
          <span style={{ color: "#fff", fontSize: 17, lineHeight: 1.1, fontWeight: 900, textShadow: "0 2px 8px rgba(0,0,0,0.95)" }}>
            {title}
          </span>
          <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 11, lineHeight: 1.2, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
            {subtitle}
          </span>
        </span>
        <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 8 }}>
          {rightContent}
        </span>
      </span>
    </button>
  );
}

export default function ContestBannerCarousel({ prizePool, onSelect }: Props) {
  const parsedPrize = Number(prizePool ?? 10);
  const prizeLabel = Number.isFinite(parsedPrize) ? parsedPrize.toLocaleString() : "10";

  return (
    <section aria-label="Contest banners" style={{ maxWidth: 680, width: "100%", margin: "18px auto 0" }}>
      <style>{`.contest-banner-rail{scrollbar-width:none;-ms-overflow-style:none}.contest-banner-rail::-webkit-scrollbar{display:none}`}</style>
      <div
        className="contest-banner-rail"
        role="region"
        aria-label="Swipe horizontally to browse contests"
        tabIndex={0}
        style={{ display: "flex", gap: 10, overflowX: "auto", overscrollBehaviorX: "contain", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}
      >
        <ContestSlide
          image="/assets/leaderboard-banner-new.png"
          eyebrow="Top Inviter"
          title="Invite friends"
          subtitle="Climb the referral leaderboard"
          onClick={() => onSelect("referral")}
          rightContent={<ArrowRight size={22} color="#fff" strokeWidth={2.5} />}
          imagePosition="center 58%"
        />
        <ContestSlide
          image="/daily-contest-banner.jpg"
          eyebrow="Daily Contest"
          title="Top Earners"
          subtitle="Take the prize"
          onClick={() => onSelect("monthly")}
          rightContent={(
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <FaTrophy style={{ color: "#FFD700", fontSize: 21, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.8))" }} />
              <span style={{ color: "#fff", fontSize: 16, lineHeight: 1, fontWeight: 900, textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>${prizeLabel}</span>
              <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em" }}>PRIZE POOL</span>
            </span>
          )}
          imagePosition="center 55%"
        />
      </div>
    </section>
  );
}
