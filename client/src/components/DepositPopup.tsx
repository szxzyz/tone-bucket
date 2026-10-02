import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
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
      setMessage(`Minimum deposit is ${MIN_GRAM_AMOUNT} GRAM.`);
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
        setMessage(`Deposit Successful! ${amt} GRAM credited.`);
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
  const openWallet = async () => {
    try {
      await tonConnectUI.openModal();
    } catch (error: any) {
      setStatus("error");
      setMessage(parseError(error, "Could not open TON wallet connection."));
    }
  };

  return (
    <PopupShell onClose={onClose} maxWidth={390} closeOnBackdrop={!busy}>
      <div style={{ position: "relative", width: "100%" }}>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, letterSpacing: "0.02em" }}>
          <span>GRAM</span> <span style={{ color: "#fff" }}>DEPOSIT</span>
        </div>
        <div style={{ marginTop: 15, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={openWallet}
            style={{ height: 36, padding: "0 16px", border: "1px solid rgba(0,152,234,0.55)", borderRadius: 8, background: "#0098ea", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,152,234,0.22)" }}
          >
            {connectedAddress ? "TON Wallet Connected" : "Connect TON Wallet"}
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Amount of GRAM</div>
          <div style={{ position: "relative" }}>
            <input
              value={amount}
              onChange={event => { setAmount(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")); setStatus("idle"); setMessage(""); }}
              disabled={busy || status === "success"}
              inputMode="decimal"
              placeholder="0.00"
              style={{ width: "100%", height: 44, boxSizing: "border-box", border: "none", outline: "none", borderRadius: 12, padding: "0 58px 0 14px", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 14, fontWeight: 700 }}
            />
            <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 800 }}>GRAM</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 7 }}>Minimum deposit: {MIN_GRAM_AMOUNT} GRAM</div>
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
          disabled={!amount || !connectedAddress || busy || status === "success"}
          style={{ width: "100%", height: 44, marginTop: 16, border: "none", borderRadius: 12, padding: "0 14px", background: amount && connectedAddress && !busy && status !== "success" ? "linear-gradient(135deg,#3d1580,#6b21a8)" : "rgba(255,255,255,0.07)", color: amount && connectedAddress && !busy && status !== "success" ? "#fff" : "rgba(255,255,255,0.25)", fontSize: 14, fontWeight: 900, cursor: amount && connectedAddress && !busy ? "pointer" : "not-allowed", boxShadow: amount && connectedAddress && !busy && status !== "success" ? "0 4px 16px rgba(61,21,128,0.35)" : "none" }}
        >
          {status === "success" ? "DONE" : "DEPOSIT NOW"}
        </button>
        <style>{`@keyframes deposit-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </PopupShell>
  );
}
