import { useState } from "react";
import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiRequest } from "@/lib/queryClient";
import PopupShell from "@/components/PopupShell";

const TREASURY = "UQCW9LwFkPRsLOVsGfl-65t9AJsfPXs8fTpDDEJL_RQhwPvJ";
const MIN_GRAM_AMOUNT = 0.1;
type Props = { open?: boolean; onClose: () => void };
type Status = "idle" | "sending" | "verifying" | "success" | "error";

function parseError(error: any, fallback: string) {
  return error?.message || fallback;
}

function TonIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" style={{ flexShrink: 0 }}>
      <path d="M28 0C12.536 0 0 12.536 0 28s12.536 28 28 28 28-12.536 28-28S43.464 0 28 0z" fill="#0098EA"/>
      <path d="M37.115 15.5H18.885c-3.4 0-5.5 3.7-3.7 6.6l10.3 17.8c.8 1.4 2.8 1.4 3.6 0l10.3-17.8c1.7-2.9-.3-6.6-3.7-6.6zm-10.5 16.5l-6.4-11.1h6.4v11.1zm2.8 0V20.9h6.4l-6.4 11.1z" fill="white"/>
    </svg>
  );
}

export default function DepositPopup({ open = true, onClose }: Props) {
  if (!open) return null;

  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);



  const createDeposit = async () => {
    const response = await apiRequest("POST", "/api/ton/deposit/verify", {
      amount: parseFloat(amount),
    });
    return response.json();
  };

  const buyGram = async () => {
    if (!connectedAddress) {
      try {
        await tonConnectUI.openModal();
      } catch {
        setStatus("error");
        setMessage("Please connect your TON wallet first");
      }
      return;
    }

    if (status === "sending" || status === "verifying") return;

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < MIN_GRAM_AMOUNT) {
      setStatus("error");
      setMessage(`Minimum deposit is ${MIN_GRAM_AMOUNT} TON.`);
      return;
    }

    try {
      setStatus("sending");
      setMessage("");

      const nanotons = BigInt(Math.round(amt * 1_000_000_000));

      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: TREASURY,
            amount: nanotons.toString(),
          },
        ],
      });

      setStatus("verifying");
      const res = await fetch("/api/ton/deposit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ boc: result.boc, amount: amt }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus("success");
        setMessage(`Deposit Successful! ${amt} TON credited.`);
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      } else if (data.pending) {
        setStatus("success");
        setMessage("Transaction sent! Balance will be credited within 5 minutes.");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else {
        setStatus("error");
        setMessage(data.message || "Verification failed. Deposit will be credited soon.");
      }
    } catch (error: any) {
      if (error?.message?.includes("User rejected")) {
        setStatus("idle");
      } else {
        setStatus("error");
        setMessage(parseError(error, "Payment failed. Please try again."));
      }
    }
  };

  const busy = status === "sending" || status === "verifying";

  return (
    <PopupShell onClose={onClose} maxWidth={390} closeOnBackdrop={!busy}>
      <div style={{ position: "relative", width: "100%" }}>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, letterSpacing: "0.02em" }}>
          <span>TON</span> <span style={{ color: "#6b21a8" }}>DEPOSIT</span>
        </div>
        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700, marginTop: 5 }}>
          Enter the deposit amount to add TON to your balance
        </div>

        {connectedAddress ? (
          <div
            style={{
              marginTop: 15, width: "100%", boxSizing: "border-box",
              display: "flex", alignItems: "center", gap: 9,
              background: "rgba(61,21,128,0.18)", borderRadius: 12, padding: "10px 12px",
            }}
          >
            <TonIcon size={17} />
            <span style={{ flex: 1, minWidth: 0, color: "#dbeafe", fontFamily: "Roboto Mono", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
            </span>
            <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>Connected</span>
            <button onClick={() => tonConnectUI.disconnect()} style={{ border: "none", background: "none", padding: 0, color: "rgba(255,255,255,0.42)", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => tonConnectUI.openModal()}
            style={{
              marginTop: 15, width: "100%", boxSizing: "border-box",
              display: "flex", alignItems: "center", gap: 9,
              border: "none", borderRadius: 12, padding: "12px 14px",
              background: "#3d1580", color: "#fff", fontSize: 13,
              fontWeight: 800, cursor: "pointer", textAlign: "left",
            }}
          >
            <TonIcon size={17} />
            <span>Connect TON Wallet</span>
          </button>
        )}

        <div style={{ marginTop: 14 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Amount of TON</div>
          <div style={{ position: "relative" }}>
            <input
              value={amount}
              onChange={event => { setAmount(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")); setStatus("idle"); setMessage(""); }}
              disabled={busy || status === "success"}
              inputMode="decimal"
              placeholder="0.00"
              style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", borderRadius: 12, padding: "13px 14px", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 16, fontWeight: "bold" }}
            />
            <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 800 }}>TON</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 7 }}>Minimum deposit: {MIN_GRAM_AMOUNT} TON</div>
        </div>



        {busy ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#d8b4fe", fontSize: 12, fontWeight: 700, marginTop: 14 }}>
            <Loader2 size={15} style={{ animation: "deposit-spin 1s linear infinite" }} />
            {status === "sending" ? "Opening wallet…" : "Verifying on blockchain…"}
          </div>
        ) : status === "success" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "#4ade80", fontSize: 12, fontWeight: 700 }}>
            <CheckCircle2 size={17} /> {message}
          </div>
        ) : status === "error" ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, color: "#f87171", fontSize: 12, lineHeight: 1.4 }}>
            <XCircle size={17} style={{ flexShrink: 0 }} /> {message}
          </div>
        ) : null}

        <button
          onClick={buyGram}
          disabled={!amount || busy || status === "success"}
          style={{ width: "100%", marginTop: 16, border: "none", borderRadius: 12, padding: "14px 0", background: amount && !busy && status !== "success" ? "linear-gradient(135deg,#3d1580,#6b21a8)" : "rgba(255,255,255,0.07)", color: amount && !busy && status !== "success" ? "#fff" : "rgba(255,255,255,0.25)", fontSize: 14, fontWeight: 900, cursor: amount && !busy ? "pointer" : "not-allowed", boxShadow: amount && !busy && status !== "success" ? "0 4px 16px rgba(61,21,128,0.35)" : "none" }}
        >
          {status === "success" ? "DONE" : connectedAddress ? "DEPOSIT NOW" : "CONNECT WALLET"}
        </button>
        <style>{`@keyframes deposit-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </PopupShell>
  );
}
