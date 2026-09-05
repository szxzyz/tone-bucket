import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { FiCheck, FiExternalLink } from "react-icons/fi";
import { Ticket } from "lucide-react";
import { useAdFlow } from "@/hooks/useAdFlow";

export default function PromoCodeInput() {
  const [promoCode, setPromoCode] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channelRequired, setChannelRequired] = useState<{ channelLink: string | null; channelName: string } | null>(null);
  const queryClient = useQueryClient();
  const { showMonetagAd } = useAdFlow();

  const redeemPromoMutation = useMutation({
    mutationFn: async ({ code }: { code: string }) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) {
        const err: any = new Error(data.message || "Invalid promo code");
        err.errorType = data.errorType;
        err.channelLink = data.channelLink;
        err.channelName = data.channelName;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      setInlineError(null);
      setChannelRequired(null);
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      if (error.errorType === 'channel_required') {
        setChannelRequired({
          channelLink: error.channelLink || null,
          channelName: error.channelName || 'Channel',
        });
        setInlineError(null);
      } else {
        setChannelRequired(null);
        setInlineError(error.message || "Invalid Code");
      }
    },
  });

  // Validate + show ad → then redeem directly (Cloudflare Turnstile challenge removed)
  const handleSubmit = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setInlineError("Please enter a promo code");
      return;
    }
    setInlineError(null);
    setChannelRequired(null);
    setBusy(true);

    try {
      const adResult = await showMonetagAd();
      if (!adResult.success) {
        setInlineError(adResult.unavailable ? "Monetag ad is not available right now. Please try again." : "Please watch the Monetag ad to claim your reward.");
        setBusy(false);
        return;
      }
    } catch {
      setInlineError("Please watch the Monetag ad to claim your reward.");
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }
    redeemPromoMutation.mutate({ code });
  };

  // "I've Joined — Verify & Claim" button — redeem directly
  const handleRetryAfterJoin = () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    redeemPromoMutation.mutate({ code });
  };

  const handleJoinChannel = () => {
    if (!channelRequired?.channelLink) return;
    const link = channelRequired.channelLink;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      if (link.includes("t.me/") && tg.openTelegramLink) tg.openTelegramLink(link);
      else if (tg.openLink) tg.openLink(link);
      else window.open(link, "_blank");
    } else {
      window.open(link, "_blank");
    }
  };

  const isDisabled = busy || redeemPromoMutation.isPending || !promoCode.trim();
  const isLoading  = busy || redeemPromoMutation.isPending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {inlineError && (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>{inlineError}</span>
      )}

      {/* Channel required message */}
      {channelRequired && (
        <div style={{
          background: "rgba(251,113,133,0.10)",
          border: "1px solid rgba(251,113,133,0.25)",
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>
            You must join <strong>{channelRequired.channelName}</strong> before claiming this promo code.
          </span>
          {channelRequired.channelLink && (
            <button
              onClick={handleJoinChannel}
              style={{
                height: 34,
                borderRadius: 8,
                border: "none",
                background: "rgba(251,113,133,0.20)",
                color: "#f87171",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <FiExternalLink size={12} />
              Join {channelRequired.channelName}
            </button>
          )}
          <button
            onClick={handleRetryAfterJoin}
            disabled={isLoading}
            style={{
              height: 34,
              borderRadius: 8,
              border: "none",
              background: isLoading ? "rgba(255,255,255,0.04)" : "rgba(34,197,94,0.15)",
              color: isLoading ? "rgba(255,255,255,0.2)" : "#22c55e",
              fontSize: 12,
              fontWeight: 700,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Verifying…" : "✓ I've Joined — Verify & Claim"}
          </button>
        </div>
      )}

      {/* Single Line Input Row - Refined Sizes */}
      <div style={{ 
        display: "flex", 
        gap: 14, // Match Daily Rewards gap
        alignItems: "center",
        background: "#333333", // Match other sections
        borderRadius: 14,
        padding: "16px 16px", // Match Daily Rewards padding
      }}>
        <Ticket size={26} color="rgba(255,255,255,0.7)" strokeWidth={2} style={{ flexShrink: 0 }} />
        
        <input
          value={promoCode}
          onChange={e => { setPromoCode(e.target.value.toUpperCase()); setInlineError(null); setChannelRequired(null); }}
          onPaste={e => {
            setInlineError(null);
            setChannelRequired(null);
          }}
          onKeyDown={e => e.key === "Enter" && !isDisabled && handleSubmit()}
          placeholder="Enter code"
          disabled={isLoading}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          style={{
            flex: 1,
            height: 40,
            background: "#333333", // Darker pill background
            border: "none",
            borderRadius: 20, // Rounded pill shape
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            outline: "none",
            letterSpacing: "0.02em",
            padding: "0 16px", // Proper horizontal padding
            minWidth: 160, // Increased width to prevent text cut
          }}
        />

        <div style={{ flex: 1 }} /> {/* Spacer to push button to the right */}

        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          style={{
            background: isDisabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
            color: isDisabled ? 'rgba(255,255,255,0.3)' : '#fff',
            border: 'none',
            width: 76, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 800,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            flexShrink: 0, letterSpacing: '0.03em',
            boxShadow: isDisabled ? 'none' : '0 2px 12px rgba(37,99,235,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}
          className={isDisabled ? "" : "active:scale-95 transition-transform"}
        >
          {isLoading ? (
            <span style={{
              width: 12, height: 12, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.2)",
              borderTopColor: "#fff",
              display: "inline-block",
              animation: "spin 0.7s linear infinite",
            }} />
          ) : (
            "APPLY"
          )}
        </button>
      </div>
    </div>
  );
}
