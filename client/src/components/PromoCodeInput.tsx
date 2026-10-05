import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { FiExternalLink } from "react-icons/fi";
import { Ticket } from "lucide-react";
import { useAdSession } from "@/hooks/useAdSession";
import { cancelRegisteredAdSession, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function PromoCodeInput() {
  const [promoCode, setPromoCode] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channelRequired, setChannelRequired] = useState<{ channelLink: string | null; channelName: string } | null>(null);
  const queryClient = useQueryClient();
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], staleTime: 300000 });
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();

  const redeemPromoMutation = useMutation({
    mutationFn: async ({ code, proof }: { code: string; proof: any }) => {
      return postWithAdVerification("/api/promo-codes/redeem", { code, proof });
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

  // Check the ambassador's channel first. Only after membership is confirmed
  // do we show the rewarded ad and submit the normal promo redemption request.
  const runPromoClaimFlow = async (verificationAttempt = false) => {
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setInlineError("Please enter a promo code");
      return;
    }
    setInlineError(null);
    setBusy(true);
    let proof: any;
    let sessionId: string | null = null;

    try {
      const checkResponse = await apiRequest("POST", "/api/promo-codes/check-channel", { code });
      const channelStatus = await checkResponse.json();
      if (!checkResponse.ok) {
        throw new Error(channelStatus.message || "Could not verify channel membership");
      }
      if (channelStatus.channelRequired && !channelStatus.isMember) {
        setChannelRequired({
          channelLink: channelStatus.channelLink || null,
          channelName: channelStatus.channelName || "Channel",
        });
        setInlineError(verificationAttempt ? "Membership not detected yet. Join the channel, then try Verify & Claim again." : null);
        return;
      }

      setChannelRequired(null);
      sessionId = startSession();
      const blockId = appConfig?.adsgramPromoBlockId || import.meta.env.VITE_ADSGRAM_PROMO_BLOCK_ID || '';
      if (!blockId) throw new Error('Promo AdsGram block is not configured. Please try again later.');
      const registration = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: "adsgram",
        context: "promo_code",
      });
      if (!registration.ok) {
        const details = await registration.json().catch(() => ({}));
        throw new Error(details.message || "Ad verification is not available right now");
      }

      await showAdgramAd(blockId);
      await waitForForeground();
      const session = endSession();
      proof = {
        sessionId: session.sessionId,
        backgroundEntered: session.backgroundEntered,
        backgroundDuration: session.backgroundDuration,
      };
    } catch (error: any) {
      if (sessionId) await cancelRegisteredAdSession(sessionId);
      cancelSession();
      setInlineError(error?.message || "Could not verify membership or complete the ad. Please try again.");
      return;
    } finally {
      setBusy(false);
    }
    redeemPromoMutation.mutate({ code, proof });
  };

  const handleSubmit = () => { void runPromoClaimFlow(); };
  const handleRetryAfterJoin = () => { void runPromoClaimFlow(true); };

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

      {/* Single Line Input Row - Refined Sizes */}
      <div style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        background: "transparent",
        borderRadius: 0,
        padding: 0,
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
            background: "#2B2B2B", // Darker pill background
            border: "none",
            borderRadius: 20, // Rounded pill shape
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            outline: "none",
            letterSpacing: "0.02em",
            padding: "0 16px", // Proper horizontal padding
            minWidth: 0,
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          style={{
            background: isDisabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3d1580, #6b21a8)',
            color: isDisabled ? 'rgba(255,255,255,0.3)' : '#fff',
            border: 'none',
            width: 76, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 800,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            flexShrink: 0, letterSpacing: '0.03em',
            boxShadow: isDisabled ? 'none' : '0 2px 12px rgba(61,21,128,0.4)',
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
      <Dialog
        open={!!channelRequired}
        onOpenChange={(open) => {
          if (!open && !isLoading) {
            setChannelRequired(null);
            setInlineError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm border-white/10 bg-[#121317] text-white">
          <DialogHeader>
            <DialogTitle>Join {channelRequired?.channelName || "the channel"}</DialogTitle>
            <DialogDescription className="text-white/65">
              Join this ambassador channel, then verify. Once verified, the rewarded ad will play before your promo reward is claimed.
            </DialogDescription>
          </DialogHeader>
          {inlineError && <p className="text-sm text-red-400">{inlineError}</p>}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleJoinChannel}
              disabled={!channelRequired?.channelLink || isLoading}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 text-sm font-bold disabled:opacity-40"
            >
              <FiExternalLink size={14} />
              {channelRequired?.channelLink ? `Join ${channelRequired.channelName}` : "Channel link unavailable"}
            </button>
            <button
              type="button"
              onClick={handleRetryAfterJoin}
              disabled={isLoading || redeemPromoMutation.isPending}
              className="h-11 rounded-xl bg-blue-600 text-sm font-bold text-white disabled:opacity-50"
            >
              {isLoading ? "Checking membership…" : "Verify & Claim"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
