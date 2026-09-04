import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Megaphone, Loader2, AlertCircle, X,
} from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";

const BLUE_ACCENT = "#4cd3ff";
const APP_BLUE = "#3b82f6";

/** Returns true only for public t.me/username links the avatar proxy can resolve. */
function hasTelegramAvatar(link: string): boolean {
  if (!link) return false;
  const m = link.match(/t\.me\/([^/?]+)/);
  if (!m) return false;
  const seg = m[1];
  // Invite-hash links (+hash) and joinchat paths have no public username.
  return !seg.startsWith('+') && seg !== 'joinchat';
}

function TaskAvatar({ task, isBot }: { task: Task; isBot: boolean }) {
  const canFetch = hasTelegramAvatar(task.link);
  const [imgOk, setImgOk] = useState(canFetch);
  const [loaded, setLoaded] = useState(false);
  const src = canFetch ? `/api/advertiser-tasks/avatar?link=${encodeURIComponent(task.link)}` : '';

  // Reset load state whenever the underlying task/link changes — otherwise a
  // failed load for one task permanently hides the image for every task after it.
  useEffect(() => {
    const ok = hasTelegramAvatar(task.link);
    setImgOk(ok);
    setLoaded(false);
  }, [task.link]);

  // Safety timeout: if the avatar proxy hasn't responded within 8 s, fall back
  // to the icon instead of leaving a blank/broken state indefinitely.
  useEffect(() => {
    if (!imgOk || loaded) return;
    const id = setTimeout(() => setImgOk(false), 8_000);
    return () => clearTimeout(id);
  }, [imgOk, loaded]);

  return (
    <div style={{
      width: 52, height: 52, borderRadius: 16, flexShrink: 0,
      overflow: "hidden",
      background: "rgba(76,211,255,0.10)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {imgOk && src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: loaded ? "block" : "none" }}
        />
      )}
      {(!imgOk || !loaded) && (
        isBot
          ? <Bot style={{ width: "22px", height: "22px", color: BLUE_ACCENT }} />
          : <Megaphone style={{ width: "22px", height: "22px", color: BLUE_ACCENT }} />
      )}
    </div>
  );
}

interface Task {
  id: string;
  taskType: string;
  title: string;
  link: string;
  verificationRequired?: boolean;
  channelVerified?: boolean;
}

interface AdvertiserTaskSheetProps {
  task: Task | null;
  open: boolean;
  reward: number;
  onClose: () => void;
  onClaim: (taskId: string) => void;
  claiming?: boolean;
}

const BG       = "rgba(13,13,16,0.99)";
const CARD_BG  = "rgba(255,255,255,0.055)";
const CARD_BDR = "rgba(255,255,255,0.08)";
const TEXT     = "#ffffff";
const TEXT_DIM = "rgba(255,255,255,0.45)";
const TEXT_FAINT = "rgba(255,255,255,0.25)";

function openLink(link: string) {
  let url = link.trim();
  if (!url.startsWith("http")) url = "https://" + url;
  const tg = (window as any).Telegram?.WebApp;
  if (tg) {
    if (url.includes("t.me/") && tg.openTelegramLink) tg.openTelegramLink(url);
    else if (tg.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, "_blank");
  } else {
    window.open(url, "_blank");
  }
}

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-[6px]" style={{ marginBottom: "4px" }}>
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i === current ? "20px" : "6px",
            background: i === current ? BLUE_ACCENT : "rgba(255,255,255,0.2)",
          }}
          transition={{ duration: 0.22 }}
          style={{ height: "6px", borderRadius: "3px" }}
        />
      ))}
    </div>
  );
}

function StepRow({
  Icon, title, body, accent = "rgba(255,255,255,0.7)",
}: {
  num: number; Icon: React.ElementType; title: string; body: string; accent?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div style={{
        width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
        background: "rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: "18px", height: "18px", color: accent }} />
      </div>
      <div style={{ paddingTop: "4px", flex: 1 }}>
        <p style={{ color: TEXT, fontWeight: 600, fontSize: "14.5px" }}>{title}</p>
        <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "4px", lineHeight: 1.55 }}>{body}</p>
      </div>
    </div>
  );
}

function ChannelPenaltyWarning() {
  const { t } = useLanguage();
  return (
    <div style={{
      padding: "12px 14px", borderRadius: "14px",
      background: "rgba(251,191,36,0.06)",
      display: "flex", alignItems: "flex-start", gap: "10px",
    }}>
      <span style={{ fontSize: "15px", flexShrink: 0, lineHeight: 1.4 }}>⚠️</span>
      <p style={{ color: "rgba(251,191,36,0.8)", fontSize: "12.5px", lineHeight: 1.55, margin: 0 }}>
        {t("channel_penalty_text")}
      </p>
    </div>
  );
}

function ActionBtn({
  onClick, disabled, color, children,
}: {
  onClick?: () => void; disabled?: boolean; color: string; children: React.ReactNode;
}) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    // primary CTA — matches the Withdraw page's action button
    indigo: { bg: APP_BLUE, border: "transparent", text: "#fff" },
    green:  { bg: "#22c55e", border: "transparent", text: "#fff" },
    blue:   { bg: APP_BLUE, border: "transparent", text: "#fff" },
    ghost:  { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.09)", text: TEXT_DIM },
  };
  const c = colors[color] ?? colors.blue;
  return (
    <motion.button
      whileTap={!disabled ? { scale: 0.97 } : {}}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", padding: "11px 14px", borderRadius: "12px",
        fontWeight: 700, fontSize: "13px",
        background: disabled ? "rgba(255,255,255,0.04)" : c.bg,
        border: "none",
        color: disabled ? TEXT_FAINT : c.text,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      }}
    >
      {children}
    </motion.button>
  );
}

export default function AdvertiserTaskSheet({
  task, open, reward, onClose, onClaim, claiming = false,
}: AdvertiserTaskSheetProps) {
  const { t } = useLanguage();
  const [botStep, setBotStep]           = useState(0);
  const [referralPasted, setReferralPasted] = useState("");
  const [opened, setOpened]             = useState(false);
  const [canClaim, setCanClaim]         = useState(false);
  const [verifying, setVerifying]       = useState(false);
  const [verifyError, setVerifyError]   = useState("");

  const reset = () => {
    setBotStep(0); setReferralPasted(""); setOpened(false);
    setCanClaim(false); setVerifying(false); setVerifyError("");
  };

  const handleClose = () => { onClose(); setTimeout(reset, 380); };

  if (!task) return null;

  const isPartner = task.taskType === "partner";
  // For partner tasks: channelVerified === true means it's a channel partner task;
  // otherwise it's a bot/website partner task.
  const isBot     = task.taskType === "bot" || (isPartner && task.channelVerified !== true);
  const isChannel = task.taskType === "channel" || (isPartner && task.channelVerified === true);
  // Partner tasks are always created with verificationRequired: true
  const withVerif = task.verificationRequired === true || isPartner;

  const handleOpen = () => {
    openLink(task.link);
    setOpened(true);
    if (!withVerif) setCanClaim(true);
  };

  const handleNonVerificationAction = () => {
    handleOpen();
    onClaim(task.id);
    handleClose();
  };

  const handleVerifyReferral = async () => {
    if (!referralPasted.trim()) return;
    setVerifying(true);
    setVerifyError("");
    await new Promise(r => setTimeout(r, 1000));

    // Extract the expected bot username from the task link
    const botUsernameMatch = task.link?.match(/t\.me\/([^/?]+)/);
    const expectedBot = botUsernameMatch ? botUsernameMatch[1].toLowerCase() : null;

    // Extract the bot username from the pasted referral link
    const pastedMatch = referralPasted.trim().match(/t\.me\/([^/?]+)/);
    const pastedBot = pastedMatch ? pastedMatch[1].toLowerCase() : null;

    if (expectedBot && pastedBot && pastedBot === expectedBot) {
      setVerifying(false);
      setCanClaim(true);
    } else {
      setVerifying(false);
      setVerifyError(
        expectedBot
          ? `Invalid link. Paste your referral link from @${expectedBot} only.`
          : "Invalid referral link. Please paste the correct link from the bot."
      );
    }
  };

  const handleCheckMembership = async () => {
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch("/api/tasks/verify-channel-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelUsername: task.link }),
      });
      const data = await res.json();
      if (data.success || data.verified) {
        setVerifying(false);
        onClaim(task.id);
        handleClose();
      } else {
        setVerifyError(data.message || t("havent_joined_channel"));
        setVerifying(false);
      }
    } catch {
      setVerifyError(t("network_error_retry"));
      setVerifying(false);
    }
  };

  // ── BOT with VERIFICATION ──
  const BotVerifiedBody = () => (
    <div className="flex flex-col gap-3">
      <div>
        <p style={{ color: TEXT, fontWeight: 600, fontSize: "14px" }}>{t("open_bot_title")}</p>
        <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "3px", lineHeight: 1.45 }}>{t("open_bot_start_body")}</p>
      </div>
      <p style={{ color: TEXT, fontWeight: 600, fontSize: "14px" }}>{t("paste_referral_title")}</p>
      <input
        type="text"
        placeholder={t("paste_referral_placeholder")}
        value={referralPasted}
        onChange={e => { setReferralPasted(e.target.value); setVerifyError(""); }}
        style={{
          width: "100%", background: "rgba(255,255,255,0.05)",
          border: `1px solid ${CARD_BDR}`, borderRadius: "12px",
          padding: "11px 13px", color: TEXT, fontSize: "13px", outline: "none",
        }}
      />
      {verifyError && (
        <div className="flex items-center gap-2">
          <AlertCircle style={{ width: "13px", height: "13px", color: "#f87171", flexShrink: 0 }} />
          <p style={{ color: "#f87171", fontSize: "12px" }}>{verifyError}</p>
        </div>
      )}
    </div>
  );

  // ── BOT with VERIFICATION — compact two-button footer ──
  const BotVerifiedFooter = () => (
    <div className="flex flex-col gap-2">
      <ActionBtn color="blue" onClick={handleOpen}>
        {t("open_bot")}
      </ActionBtn>
      <ActionBtn
        color="green"
        onClick={() => {
          if (canClaim) {
            onClaim(task.id);
            handleClose();
          } else {
            handleVerifyReferral();
          }
        }}
        disabled={!opened || !referralPasted.trim() || verifying || claiming}
      >
        {verifying || claiming
          ? <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} />
          : <>Verify &amp; Claim</>}
      </ActionBtn>
    </div>
  );

  // ── CHANNEL with VERIFICATION — body ──
  const ChannelVerifiedBody = () => (
    <div className="flex flex-col gap-3">
      <ChannelPenaltyWarning />
      <div>
        <p style={{ color: TEXT, fontWeight: 600, fontSize: "14px" }}>{t("join_the_channel_task")}</p>
        <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "3px", lineHeight: 1.45 }}>{t("join_channel_task_body")}</p>
      </div>
      {opened && verifyError && (
        <div className="flex items-center gap-2">
          <AlertCircle style={{ width: "13px", height: "13px", color: "#f87171", flexShrink: 0 }} />
          <p style={{ color: "#f87171", fontSize: "12px" }}>{verifyError}</p>
        </div>
      )}
    </div>
  );

  // ── CHANNEL with VERIFICATION — compact two-button footer ──
  const ChannelVerifiedFooter = () => (
    <div className="flex flex-col gap-2">
      <ActionBtn color="blue" onClick={handleOpen}>
        {t("open_channel")}
      </ActionBtn>
      <ActionBtn color="green" onClick={handleCheckMembership} disabled={!opened || verifying || claiming}>
        {verifying || claiming
          ? <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} />
          : <>Verify &amp; Claim</>}
      </ActionBtn>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[72]"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)" }}
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 z-[73]"
            style={{
              background: BG,
              backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
              borderRadius: "24px 24px 0 0",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Sticky header ── */}
            <div style={{ flexShrink: 0 }}>
              {/* Handle + close */}
              <div className="flex items-center justify-between px-5 pt-4 pb-0">
                <div style={{ width: "32px" }} />
                <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.12)" }} />
                <button onClick={handleClose} style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  background: "rgba(255,255,255,0.07)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}>
                  <X style={{ width: "15px", height: "15px", color: TEXT_DIM }} />
                </button>
              </div>

              {/* Task info */}
              <div className="px-6 pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <TaskAvatar task={task} isBot={isBot} />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{
                      color: TEXT, fontSize: "17px", fontWeight: 800, letterSpacing: "-0.02em",
                      lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                      {task.title}
                    </h2>
                    <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "3px" }}>
                      {isBot ? t("looking_for_referrals") : t("looking_for_subscribers")}
                    </p>
                  </div>
                </div>

              </div>

              {/* Divider */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 20px" }} />
            </div>

            {/* ── Scrollable content ── */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 20px 12px",
            }}>
              {isBot     && withVerif  && <BotVerifiedBody />}
              {isBot     && !withVerif && (
                <StepRow num={1} Icon={Bot} accent={BLUE_ACCENT}
                  title={t("open_the_bot")}
                  body={t("open_bot_instant_body")} />
              )}
              {isChannel && withVerif  && <ChannelVerifiedBody />}
              {isChannel && !withVerif && (
                <StepRow num={1} Icon={Megaphone} accent={BLUE_ACCENT}
                  title={t("open_the_channel")}
                  body={t("open_channel_instant_body")} />
              )}
            </div>

            {/* ── Fixed footer — primary action, matches the Advertise "Pay" button ── */}
            <div style={{
              flexShrink: 0, padding: "14px 20px",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
              background: BG,
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}>
              {isBot     && withVerif  && <BotVerifiedFooter />}
              {isBot     && !withVerif && (
                <ActionBtn color="blue" onClick={handleNonVerificationAction} disabled={claiming}>
                  {claiming
                    ? <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} />
                    : <>Claim</>}
                </ActionBtn>
              )}
              {isChannel && withVerif  && <ChannelVerifiedFooter />}
              {isChannel && !withVerif && (
                <ActionBtn color="blue" onClick={handleNonVerificationAction} disabled={claiming}>
                  {claiming
                    ? <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} />
                    : <>Claim</>}
                </ActionBtn>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
