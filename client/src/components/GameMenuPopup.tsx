import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Users, Activity, Coins, ClipboardList, CheckCircle2,
  Receipt, Shield, ShieldCheck, ScrollText, Clock, CheckCircle,
  XCircle, Loader2, Trophy, Video, Link2, Eye, CheckSquare, Square,
  X, Plus, Youtube, Instagram,
} from "lucide-react";
import { RiBarChartFill } from "react-icons/ri";
import { BsQuestionCircleFill } from "react-icons/bs";
import { MdOutlineSupportAgent } from "react-icons/md";
import { format } from "date-fns";
import { getTONPrice } from "@/lib/tonPriceService";
import { TonIcon } from "@/components/TonIcon";
import { useAdmin } from "@/hooks/useAdmin";
import { useSupportLink } from "@/hooks/useSupportLink";
import { useLanguage } from "@/hooks/useLanguage";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";
import { LanguagePreferenceControl } from "@/components/SettingsPopup";

interface MenuPopupProps {
  onClose: () => void;
  initialView?: View;
  fullScreen?: boolean;
}

type View = "main" | "transactions" | "stats" | "faq" | "legal" | "contest" | "language";
type LegalDocument = "terms" | "privacy" | "acceptable";

const VIEW_RANGES = [
  { label: "100 – 999 Views", value: "100-999", reward: "100 GEM" },
  { label: "1K – 4.9K Views", value: "1k-4.9k", reward: "250 GEM" },
  { label: "5K – 9.9K Views", value: "5k-9.9k", reward: "500 GEM" },
  { label: "10K – 49.9K Views", value: "10k-49.9k", reward: "1K GEM" },
  { label: "50K – 99.9K Views", value: "50k-99.9k", reward: "5K GEM" },
  { label: "100K – 499.9K Views", value: "100k-499.9k", reward: "10K GEM" },
  { label: "500K – 999.9K Views", value: "500k-999.9k", reward: "25K GEM" },
  { label: "1M+ Views", value: "1m+", reward: "100K GEM" },
];

export default function MenuPopup({ onClose, initialView = "main", fullScreen = false }: MenuPopupProps) {
  const [view, setView] = useState<View>(initialView);
  const contestFullScreen = initialView === "contest";
  const [selectedLegal, setSelectedLegal] = useState<LegalDocument | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const documentScreen = fullScreen || selectedLegal !== null || (contestFullScreen && view === "contest");

  // Contest form state
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [link, setLink] = useState("");
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [transactionPage, setTransactionPage] = useState(0);
  const [tonPrice, setTonPrice] = useState<number | null>(null);
  const { isAdmin } = useAdmin();
  const { t } = useLanguage();
  const supportLink = useSupportLink();
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 60000,
  });

  const { data: txData, isLoading: txLoading } = useQuery<any>({
    queryKey: ["/api/withdrawals"],
    enabled: view === "transactions",
    retry: false,
  });
  const { data: appStatistics } = useQuery<any>({
    queryKey: ["/api/public/statistics"],
    enabled: view === "stats",
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const telegramUser =
    typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user
      : null;

  const photoUrl = telegramUser?.photo_url || user?.profileImageUrl || null;
  const displayName = user?.firstName || telegramUser?.first_name || "User";
  const username = user?.telegramUsername || telegramUser?.username || null;
  const telegramId = user?.telegramId || telegramUser?.id?.toString() || null;

  const withdrawals = txData?.withdrawals || [];
  const transactionsPerPage = 5;
  const transactionPageCount = Math.max(1, Math.ceil(withdrawals.length / transactionsPerPage));
  const visibleWithdrawals = withdrawals.slice(transactionPage * transactionsPerPage, (transactionPage + 1) * transactionsPerPage);
  React.useEffect(() => {
    setTransactionPage(page => Math.min(page, transactionPageCount - 1));
  }, [transactionPageCount]);
  React.useEffect(() => {
    if (view !== "transactions") return;
    getTONPrice().then(price => { if (Number.isFinite(price) && price > 0) setTonPrice(price); }).catch(() => {});
  }, [view]);

  const contestMutation = useMutation({
    mutationFn: async (data: { link: string; viewsRange: string }) => {
      const res = await fetch("/api/contest/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const canSubmit =
    link.trim() !== "" &&
    selectedRange !== null &&
    check1 &&
    check2 &&
    check3;

  const handleContestSubmit = () => {
    if (!canSubmit) return;
    contestMutation.mutate({ link: link.trim(), viewsRange: selectedRange! });
  };

  const resetContestForm = () => {
    setLink("");
    setSelectedRange(null);
    setCheck1(false);
    setCheck2(false);
    setCheck3(false);
    setSubmitted(false);
    setShowSubmitForm(false);
  };

  const getStatusIcon = (status: string) => {
    const s = status?.toLowerCase();
    if (s?.includes("approved") || s?.includes("success") || s?.includes("paid"))
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (s?.includes("reject") || s?.includes("failed"))
      return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-yellow-400" />;
  };

  const getStatusColor = (status: string) => {
    const s = status?.toLowerCase();
    if (s?.includes("approved") || s?.includes("success") || s?.includes("paid")) return "text-green-400";
    if (s?.includes("reject") || s?.includes("failed")) return "text-red-400";
    return "text-yellow-400";
  };

  const viewTitle: Record<View, string> = {
    main: "Menu",
    transactions: "Transactions",
    stats: "Project Statistics",
    faq: t("faq_title"),
    legal: t("legal_info"),
    contest: "Contest",
    language: t("language"),
  };

  const legalTitles: Record<LegalDocument, string> = {
    terms: t("terms_conditions"),
    privacy: t("privacy_policy"),
    acceptable: t("acceptable_use"),
  };

  const openLegalDocument = (document: LegalDocument) => {
    setSelectedLegal(document);
  };

  return (
    <AnimatePresence>
      <motion.div
        className={`fixed inset-0 z-[1300] flex justify-center ${documentScreen ? "items-stretch" : "items-end"}`}
        initial={documentScreen ? { opacity: 0, x: "100%" } : { opacity: 0 }}
        animate={documentScreen ? { opacity: 1, x: 0 } : { opacity: 1 }}
        exit={documentScreen ? { opacity: 0, x: "100%" } : { opacity: 0 }}
      >
        {!documentScreen && <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />}

        <motion.div
          className={`relative w-full ${documentScreen ? "max-w-none h-full max-h-none rounded-none flex flex-col" : "max-w-md rounded-t-2xl"} ${documentScreen ? "bg-[#0f0f0f]" : "bg-[#0f0f0f]"} border border-white/10 overflow-hidden`}
          initial={documentScreen ? { x: "100%" } : { y: "100%" }}
          animate={documentScreen ? { x: 0 } : { y: 0 }}
          exit={documentScreen ? { x: "100%" } : { y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          style={{ maxHeight: documentScreen ? "none" : "90vh", overflowY: "auto" }}
        >
          {!documentScreen && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-white/20" /></div>}

          {/* Header */}
          <div className={documentScreen ? "p-6 border-b border-white/5 flex items-center justify-between" : "flex items-center gap-3 px-5 py-3 border-b border-white/5"}>
            <h2 className={documentScreen ? "text-xl font-bold text-white uppercase tracking-tight italic" : "text-white font-bold text-base"}>{view === "legal" && selectedLegal ? legalTitles[selectedLegal] : viewTitle[view]}</h2>
            {documentScreen && (
              <button type="button" onClick={onClose} aria-label="Close popup" className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 text-white/70 hover:bg-white/10 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* ─── Main View ─── */}
          {view === "main" && (
            <div className="px-5 py-4 space-y-3">
              {/* Account Info */}
              <div className="bg-white/5 rounded-2xl p-4">
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Account Info</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAdmin) return;
                      onClose();
                      setLocation("/admin");
                    }}
                    aria-label={isAdmin ? "Open admin panel" : "Profile"}
                    className={`w-14 h-14 rounded-full overflow-hidden border border-white/10 bg-[#1b1b1b] flex items-center justify-center flex-shrink-0 ${isAdmin ? "cursor-pointer active:scale-95 transition-transform" : "cursor-default"}`}
                  >
                    {photoUrl ? (
                      <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-white/40" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{displayName}</p>
                    {username && <p className="text-white/50 text-xs mt-0.5">@{username}</p>}
                    {telegramId && <p className="text-white/30 text-[10px] mt-1 font-mono">ID: {telegramId}</p>}
                  </div>
                </div>
              </div>

              {/* Transactions */}
              <button
                onClick={() => setView("transactions")}
                className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Receipt className="w-5 h-5 text-yellow-400" />
                  <span className="text-white font-bold text-sm">Transactions</span>
                </div>
              </button>

              <button onClick={() => setView("stats")} className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]">
                <div className="flex items-center gap-3"><RiBarChartFill className="w-5 h-5 text-blue-400" /><span className="text-white font-bold text-sm">Project Statistics</span></div>
              </button>

              <button onClick={() => setView("faq")} className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]">
                <div className="flex items-center gap-3"><BsQuestionCircleFill className="w-5 h-5 text-sky-400" /><span className="text-white font-bold text-sm">FAQs</span></div>
              </button>

              <button onClick={() => {
                if (!supportLink) {
                  showNotification("Support link is not configured", "error");
                  return;
                }
                const tg = (window as any).Telegram?.WebApp;
                if (tg?.openTelegramLink) tg.openTelegramLink(supportLink); else window.open(supportLink, "_blank", "noopener,noreferrer");
              }} className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]">
                <div className="flex items-center gap-3"><MdOutlineSupportAgent className="w-5 h-5 text-pink-400" /><span className="text-white font-bold text-sm">Support</span></div>
              </button>

              {/* Legal Info */}
              <button
                onClick={() => setView("legal")}
                className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-purple-400" />
                  <span className="text-white font-bold text-sm">Legal & Info</span>
                </div>
              </button>
            </div>
          )}

          {/* ─── Transactions View ─── */}
          {view === "transactions" && (
            <div style={{ padding: 16, overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
              {txLoading ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /></div>
              ) : (
                <>
                  <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 14, overflow: "hidden" }}>
                    {withdrawals.length === 0 ? <div style={{ padding: 26, textAlign: "center", color: "rgba(255,255,255,.3)", fontSize: 12 }}>No transactions yet</div> : visibleWithdrawals.map((w: any) => {
                      const status = String(w.status || "pending").toLowerCase();
                      const color = status === "approved" || status === "completed" || status === "paid" ? "#4ade80" : status === "rejected" ? "#f87171" : "#fbbf24";
                      const details = w.details || {};
                      const grm = Number(w.grmAmount ?? w.goldAmount ?? details.grmAmount ?? details.goldAmount ?? w.amount ?? 0);
                      const ton = Number(details.tonAmount ?? w.cryptoAmount ?? details.cryptoAmount ?? (tonPrice ? Number(w.usdValue ?? details.usdValue ?? 0) / tonPrice : NaN));
                      const date = w.createdAt ? new Date(w.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
                      return <div key={w.id} style={{ padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}><img src="/assets/gems-icon.svg" alt="GEM" style={{ width: 22, height: 22, objectFit: "contain" }} /><span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>{grm.toLocaleString()} GEM</span></div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}><TonIcon size={20} /><span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>{Number.isFinite(ton) && ton > 0 ? ton.toFixed(6) : "—"} TON</span></div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7, color: "rgba(255,255,255,.35)", fontSize: 10 }}><span>{date}</span><span style={{ fontSize: 9, fontWeight: 800, padding: "3px 9px", borderRadius: 50, background: `${color}18`, border: `1px solid ${color}40`, color, textTransform: "uppercase", letterSpacing: ".04em" }}>{w.status || "pending"}</span></div>
                      </div>;
                    })}
                  </div>
                  {transactionPageCount > 1 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
                    <button type="button" onClick={() => setTransactionPage(page => Math.max(0, page - 1))} disabled={transactionPage === 0} style={{ flex: 1, border: "none", borderRadius: 12, padding: "11px 12px", background: transactionPage === 0 ? "rgba(255,255,255,.05)" : "rgba(37,99,235,.18)", color: transactionPage === 0 ? "rgba(255,255,255,.25)" : "#93c5fd", fontSize: 12, fontWeight: 800 }}>Previous</button>
                    <span style={{ color: "rgba(255,255,255,.4)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{transactionPage + 1} / {transactionPageCount}</span>
                    <button type="button" onClick={() => setTransactionPage(page => Math.min(transactionPageCount - 1, page + 1))} disabled={transactionPage >= transactionPageCount - 1} style={{ flex: 1, border: "none", borderRadius: 12, padding: "11px 12px", background: transactionPage >= transactionPageCount - 1 ? "rgba(255,255,255,.05)" : "rgba(37,99,235,.18)", color: transactionPage >= transactionPageCount - 1 ? "rgba(255,255,255,.25)" : "#93c5fd", fontSize: 12, fontWeight: 800 }}>Next</button>
                  </div>}
                </>
              )}
            </div>
          )}

          {view === "language" && (
            <div className="px-4 py-4 space-y-3">
              <p className="text-white/40 text-xs">{t("select_language")}</p>
              <LanguagePreferenceControl />
            </div>
          )}

          {view === "stats" && (
            <div className="px-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Total users", value: appStatistics ? Number(appStatistics.totalUsers ?? 0).toLocaleString() : "—", icon: Users },
                  { label: "Active today", value: appStatistics ? Number(appStatistics.activeToday ?? 0).toLocaleString() : "—", icon: Activity },
                  { label: "GEM earned", value: appStatistics ? Number(appStatistics.goldEarned ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—", icon: Coins },
                  { label: "Total withdrawal", value: appStatistics ? `${Number(appStatistics.totalWithdrawal ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} TON` : "—", icon: Coins },
                  { label: "Tasks created", value: appStatistics ? Number(appStatistics.taskCreated ?? 0).toLocaleString() : "—", icon: ClipboardList },
                  { label: "Tasks completed", value: appStatistics ? Number(appStatistics.taskCompleted ?? 0).toLocaleString() : "—", icon: CheckCircle2 },
                ].map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className="rounded-xl bg-white/[0.05] p-3 min-w-0">
                      <Icon className="w-4 h-4 text-white/60 mb-1.5" strokeWidth={2.1} />
                      <div className="text-white text-base font-black leading-tight truncate">{card.value}</div>
                      <div className="text-white/40 text-[10px] mt-1 truncate">{card.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === "faq" && (
            <div className="px-5 py-4 space-y-2">
              {[
                [t("faq_earn_q"), t("faq_earn_a")],
                [t("faq_referral_q"), t("faq_referral_a")],
                [t("faq_withdraw_q"), t("faq_withdraw_a")],
                [t("faq_status_q"), t("faq_status_a")],
                [t("faq_currency_q"), t("faq_currency_a")],
                [t("faq_contest_q"), t("faq_contest_a")],
                [t("faq_language_q"), t("faq_language_a")],
                [t("faq_accounts_q"), t("faq_accounts_a")],
                [t("faq_proof_q"), t("faq_proof_a")],
              ].map(([question, answer], index) => {
                const isOpen = openFaqIndex === index;
                const answerId = `faq-answer-${index}`;
                return (
                  <div key={question} className="rounded-2xl bg-white/5 overflow-hidden">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={answerId}
                      onClick={() => setOpenFaqIndex(current => current === index ? null : index)}
                      className="w-full flex items-center justify-between gap-3 p-4 text-left"
                    >
                      <span className="text-white font-bold text-sm">{question}</span>
                      <span aria-hidden="true" className="text-white/50 text-lg leading-none shrink-0">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && <p id={answerId} className="px-4 pb-4 text-white/45 text-xs leading-relaxed">{answer}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Legal View ─── */}
          {view === "legal" && !selectedLegal && (
            <div className="px-5 py-4 space-y-3">
              {([
                { id: "terms" as LegalDocument, label: t("terms_conditions"), icon: Shield, color: "text-emerald-400" },
                { id: "privacy" as LegalDocument, label: t("privacy_policy"), icon: ScrollText, color: "text-orange-400" },
                { id: "acceptable" as LegalDocument, label: t("acceptable_use"), icon: ShieldCheck, color: "text-rose-400" },
              ]).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => openLegalDocument(item.id)}
                    className="w-full flex items-center gap-3 bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${item.color}`} />
                      <span className="text-white font-bold text-sm">{item.label}</span>
                    </div>
                      </button>
                );
              })}
            </div>
          )}

          {view === "legal" && selectedLegal && (
            <div className="flex-1 overflow-y-auto p-6 text-gray-400 text-sm leading-relaxed">
              {selectedLegal === "terms" && (
                <div className="space-y-4">
                  <p className="text-[#B9FF66] font-bold">{t("legal_last_updated")}</p>
                  <p>{t("legal_terms_intro")}</p>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_terms_eligibility_title")}</h4><p>{t("legal_terms_eligibility")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_terms_rewards_title")}</h4><p>{t("legal_terms_gem")}</p><p className="mt-2">{t("legal_terms_referrals")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_terms_withdrawals_title")}</h4><p>{t("legal_terms_withdrawals")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_terms_fair_use_title")}</h4><p>{t("legal_terms_fair_use")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_terms_changes_title")}</h4><p>{t("legal_terms_changes")}</p></div>
                </div>
              )}
              {selectedLegal === "privacy" && (
                <div className="space-y-4">
                  <p>{t("legal_privacy_intro")}</p>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_privacy_data_title")}</h4><p>{t("legal_privacy_data")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_privacy_wallet_title")}</h4><p>{t("legal_privacy_wallet")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_privacy_services_title")}</h4><p>{t("legal_privacy_services")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_privacy_retention_title")}</h4><p>{t("legal_privacy_retention")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">{t("legal_privacy_contact_title")}</h4><p>{t("legal_privacy_contact")}</p></div>
                </div>
              )}
              {selectedLegal === "acceptable" && (
                <div className="space-y-4">
                  <p>{t("legal_acceptable_intro")}</p>
                  <div><h4 className="text-rose-400 font-bold mb-1 italic uppercase tracking-tighter">{t("legal_acceptable_rules_title")}</h4><p>{t("legal_acceptable_prohibited")}</p></div>
                  <div><h4 className="text-white font-bold mb-1 flex items-center gap-2 italic uppercase tracking-tighter"><ShieldCheck className="w-4 h-4 text-[#B9FF66]" />{t("legal_acceptable_enforcement_title")}</h4><p>{t("legal_acceptable_enforcement")}</p></div>
                </div>
              )}
            </div>
          )}

          {/* ─── Contest View ─── */}
          {view === "contest" && !showSubmitForm && (
            <div className={(fullScreen || contestFullScreen) ? "flex-1 overflow-y-auto p-6 space-y-4" : "px-5 py-4 space-y-4"}>
              {/* Hero */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-[#F5C542]/20 via-[#F5C542]/5 to-transparent border border-[#F5C542]/20 p-4">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#F5C542]/10 rounded-full blur-2xl" />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-xl bg-[#F5C542]/20 border border-[#F5C542]/30 flex items-center justify-center mb-3">
                    <Trophy className="w-5 h-5 text-[#F5C542]" />
                  </div>
                  <p className="text-white font-black text-sm leading-snug">
                    Tell others about Lightning GEM, and get up to{" "}
                    <span className="text-[#F5C542]">10,000,000 GEM</span> for each video.
                  </p>
                </div>
              </div>

              {/* Rules */}
              <div className="space-y-2">
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Rules</p>

                <div className="bg-white/5 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#F5C542]/20 flex items-center justify-center text-[#F5C542] font-black text-[10px] flex-shrink-0">1</span>
                    <p className="text-white font-bold text-xs">Create Content</p>
                  </div>
                  <p className="text-white/50 text-[11px] leading-relaxed pl-7">Make a fun video about Lightning GEM and post it on:</p>
                  <div className="flex gap-1.5 flex-wrap pl-7">
                    <div className="flex items-center gap-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1">
                      <Youtube className="w-3 h-3 text-red-400" />
                      <span className="text-red-400 text-[10px] font-bold">YouTube Shorts</span>
                    </div>
                    <div className="flex items-center gap-1 bg-pink-500/10 border border-pink-500/20 rounded-lg px-2 py-1">
                      <Instagram className="w-3 h-3 text-pink-400" />
                      <span className="text-pink-400 text-[10px] font-bold">Instagram Reels</span>
                    </div>
                    <div className="flex items-center gap-1 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-2 py-1">
                      <Video className="w-3 h-3 text-cyan-400" />
                      <span className="text-cyan-400 text-[10px] font-bold">TikTok</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-3.5">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#F5C542]/20 flex items-center justify-center text-[#F5C542] font-black text-[10px] flex-shrink-0 mt-0.5">2</span>
                    <div>
                      <p className="text-white font-bold text-xs">Include Your ID or Invite Link</p>
                      <p className="text-white/50 text-[11px] leading-relaxed mt-1">Attach your ID or Invite Link in the video description.</p>
                      <p className="text-[#F5C542]/70 text-[10px] mt-1 flex items-center gap-1">
                        <Link2 className="w-2.5 h-2.5" />
                        Get Your Invite Link in the Friends Section
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-3.5">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#F5C542]/20 flex items-center justify-center text-[#F5C542] font-black text-[10px] flex-shrink-0 mt-0.5">3</span>
                    <div>
                      <p className="text-white font-bold text-xs">Send the Link</p>
                      <p className="text-white/50 text-[11px] leading-relaxed mt-1">Once your video reaches 100+ views, send us the link.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-3.5">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#F5C542]/20 flex items-center justify-center text-[#F5C542] font-black text-[10px] flex-shrink-0 mt-0.5">4</span>
                    <div>
                      <p className="text-white font-bold text-xs">Earn Rewards</p>
                      <p className="text-white/50 text-[11px] leading-relaxed mt-1">
                        The more views your video gets, the bigger the reward. Up to{" "}
                        <span className="text-[#F5C542] font-bold">10,000,000 GEM</span> per video.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reward Table */}
              <div className="bg-white/5 rounded-2xl overflow-hidden">
                <div className="px-3.5 pt-3 pb-1">
                  <p className="text-white/40 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Reward Table
                  </p>
                </div>
                <div className="divide-y divide-white/5">
                  {VIEW_RANGES.map((r) => (
                    <div key={r.value} className="flex items-center justify-between px-3.5 py-2">
                      <span className="text-white/60 text-[11px]">{r.label}</span>
                      <span className="text-[#F5C542] font-bold text-[11px]">{r.reward}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <button
                onClick={() => setShowSubmitForm(true)}
                className="w-full flex items-center justify-center gap-2 bg-[#F5C542] hover:bg-[#F5C542]/90 text-black font-black text-sm rounded-2xl py-3.5 transition-all active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                Add Content and Earn
              </button>

              <div className="h-2" />
            </div>
          )}

          {/* ─── Contest Submission Form ─── */}
          {view === "contest" && showSubmitForm && (
            <div className={(fullScreen || contestFullScreen) ? "flex-1 overflow-y-auto p-6 space-y-4" : "px-5 py-4 space-y-4"}>
              {submitted ? (
                <div className="flex flex-col items-center gap-4 text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Trophy className="w-8 h-8 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-black text-base">Submitted!</p>
                    <p className="text-white/50 text-xs mt-1 leading-relaxed">
                      Your submission has been sent for review. You'll be notified once it's verified.
                    </p>
                  </div>
                  <button
                    onClick={() => { resetContestForm(); setView("main"); }}
                    className="bg-[#F5C542] text-black font-black text-sm rounded-2xl px-8 py-3"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-white/40 text-[10px] font-black uppercase tracking-widest block mb-2">
                      Add a link to Verify
                    </p>
                  </div>

                  {/* Link Input */}
                  <div>
                    <label className="text-white/40 text-[10px] font-semibold uppercase tracking-wide block mb-1.5">
                      Link to your content
                    </label>
                    <input
                      type="url"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      placeholder="Paste your video link here"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-[#F5C542]/40 transition-colors"
                    />
                  </div>

                  {/* Views Range */}
                  <div>
                    <label className="text-white/40 text-[10px] font-semibold uppercase tracking-wide block mb-1.5">
                      Number of Views
                    </label>
                    <div className="space-y-1.5">
                      {VIEW_RANGES.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => setSelectedRange(r.value)}
                          className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 border transition-all ${
                            selectedRange === r.value
                              ? "bg-[#F5C542]/10 border-[#F5C542]/40"
                              : "bg-white/5 border-white/5 hover:bg-white/8"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                selectedRange === r.value ? "border-[#F5C542] bg-[#F5C542]" : "border-white/30"
                              }`}
                            >
                              {selectedRange === r.value && (
                                <div className="w-1.5 h-1.5 rounded-full bg-black" />
                              )}
                            </div>
                            <span className="text-white/80 text-xs">{r.label}</span>
                          </div>
                          <span className="text-[#F5C542] font-bold text-xs">{r.reward}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Checkboxes */}
                  <div className="space-y-2.5">
                    <label className="text-white/40 text-[10px] font-semibold uppercase tracking-wide block">
                      Confirmation
                    </label>
                    {[
                      { state: check1, set: setCheck1, label: "I confirm that the number of views is correct" },
                      { state: check2, set: setCheck2, label: "My invite link or my ID (Telegram ID) is indicated under the video" },
                      { state: check3, set: setCheck3, label: "I understand that if I provide incorrect data, I will lose access to this functionality" },
                    ].map((item, i) => (
                      <button
                        key={i}
                        onClick={() => item.set(!item.state)}
                        className="w-full flex items-start gap-2.5 text-left"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {item.state ? (
                            <CheckSquare className="w-4.5 h-4.5 text-[#F5C542]" style={{ width: 18, height: 18 }} />
                          ) : (
                            <Square className="w-4.5 h-4.5 text-white/30" style={{ width: 18, height: 18 }} />
                          )}
                        </div>
                        <span className="text-white/60 text-xs leading-relaxed">{item.label}</span>
                      </button>
                    ))}
                  </div>

                  {contestMutation.isError && (
                    <p className="text-red-400 text-xs text-center">
                      {(contestMutation.error as Error).message}
                    </p>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleContestSubmit}
                    disabled={!canSubmit || contestMutation.isPending}
                    className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all ${
                      canSubmit && !contestMutation.isPending
                        ? "bg-[#F5C542] text-black hover:bg-[#F5C542]/90 active:scale-[0.98]"
                        : "bg-white/10 text-white/30 cursor-not-allowed"
                    }`}
                  >
                    {contestMutation.isPending ? "Submitting..." : "Submit"}
                  </button>

                  <div className="h-2" />
                </>
              )}
            </div>
          )}

          {!documentScreen && <div className="h-6" />}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
