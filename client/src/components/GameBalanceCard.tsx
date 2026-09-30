import { ArrowDownToLine } from "lucide-react";
import FarmingMatrixCounter from "@/components/FarmingMatrixCounter";

type Props = {
  balance: number;
  onWithdraw: () => void;
};

export default function GameBalanceCard({ balance, onWithdraw }: Props) {
  const safeBalance = Number.isFinite(balance) ? Math.max(0, balance) : 0;

  return (
    <section
      aria-label="Gold balance"
      style={{
        maxWidth: 680,
        width: "100%",
        margin: "0 auto 18px",
        padding: 16,
        boxSizing: "border-box",
        borderRadius: 16,
        background: "#141414",
        boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <span style={{ color: "#8e8e93", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Gold balance
        </span>
        <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 26, height: 26, objectFit: "contain" }} />
      </div>
      <FarmingMatrixCounter amount={safeBalance} decimals={0} />
      <button
        type="button"
        onClick={onWithdraw}
        className="active:scale-[0.98] transition-transform"
        style={{
          width: "100%",
          height: 44,
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          border: 0,
          borderRadius: 12,
          background: "linear-gradient(135deg, #6b21a8, #9333ea)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 900,
          letterSpacing: "0.04em",
          cursor: "pointer",
        }}
      >
        <ArrowDownToLine size={17} />
        Withdraw
      </button>
    </section>
  );
}
