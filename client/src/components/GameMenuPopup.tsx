import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Receipt, ChevronRight, Shield, ShieldCheck, ScrollText, ArrowLeft, Clock, CheckCircle,
  XCircle, Loader2, Trophy, Video, Link2, Eye, CheckSquare, Square,
  X, Plus, Youtube, Instagram, Download,
} from "lucide-react";
import { format } from "date-fns";

interface MenuPopupProps {
  onClose: () => void;
  onWithdraw?: () => void;
  initialView?: View;
  fullScreen?: boolean;
}

type View = "main" | "transactions" | "legal" | "contest";
type LegalDocument = "terms" | "privacy" | "acceptable";

const VIEW_RANGES = [
  { label: "100 – 999 Views", value: "100-999", reward: "100 GRM" },
  { label: "1K – 4.9K Views", value: "1k-4.9k", reward: "250 GRM" },
  { label: "5K – 9.9K Views", value: "5k-9.9k", reward: "500 GRM" },
  { label: "10K – 49.9K Views", value: "10k-49.9k", reward: "1K GRM" },
  { label: "50K – 99.9K Views", value: "50k-99.9k", reward: "5K GRM" },
  { label: "100K – 499.9K Views", value: "100k-499.9k", reward: "10K GRM" },
  { label: "500K – 999.9K Views", value: "500k-999.9k", reward: "25K GRM" },
  { label: "1M+ Views", value: "1m+", reward: "100K GRM" },
];

export default function MenuPopup({ onClose, onWithdraw, initialView = "main", fullScreen = false }: MenuPopupProps) {
  const [view, setView] = useState<View>(initialView);
  const [contestFullScreen, setContestFullScreen] = useState(initialView === "contest");
  const [selectedLegal, setSelectedLegal] = useState<LegalDocument | null>(null);
  const documentScreen = fullScreen || selectedLegal !== null || (contestFullScreen && view === "contest");

  // Contest form state
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [link, setLink] = useState("");
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const telegramUser =
    typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user
      : null;

  const photoUrl = telegramUser?.photo_url || user?.profileImageUrl || null;
  const displayName = user?.firstName || telegramUser?.first_name || "User";
  const username = user?.telegramUsername || telegramUser?.username || null;
  const telegramId = user?.telegramId || telegramUser?.id?.toString() || null;

  const withdrawals = txData?.withdrawals || [];

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
    legal: "Legal & Info",
    contest: "Contest",
  };

  const legalTitles: Record<LegalDocument, string> = {
    terms: "Terms & Conditions",
    privacy: "Privacy Policy",
    acceptable: "Acceptable Use",
  };

  const openLegalDocument = (document: LegalDocument) => {
    setSelectedLegal(document);
  };

  const closeLegalDocument = () => {
    setSelectedLegal(null);
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
            {view !== "main" && !documentScreen && (
              <button
                onClick={() => {
                  if (view === "legal" && selectedLegal) closeLegalDocument();
                  else { setView("main"); resetContestForm(); }
                }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>
            )}
            <h2 className={documentScreen ? "text-xl font-bold text-white uppercase tracking-tight italic" : "text-white font-bold text-base"}>{view === "legal" && selectedLegal ? legalTitles[selectedLegal] : viewTitle[view]}</h2>
          </div>

          {/* ─── Main View ─── */}
          {view === "main" && (
            <div className="px-5 py-4 space-y-3">
              {/* Account Info */}
              <div className="bg-white/5 rounded-2xl p-4">
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Account Info</p>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full overflow-hidden border border-white/10 bg-[#1b1b1b] flex items-center justify-center flex-shrink-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-white/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{displayName}</p>
                    {username && <p className="text-white/50 text-xs mt-0.5">@{username}</p>}
                    {telegramId && <p className="text-white/30 text-[10px] mt-1 font-mono">ID: {telegramId}</p>}
                  </div>
                </div>
              </div>

              {/* Contest */}
              <button
                onClick={() => { setContestFullScreen(true); setView("contest"); }}
                className="w-full flex items-center justify-between bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-[#F5C542]" />
                  <span className="text-white font-bold text-sm">Contest</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>

              {/* Withdraw */}
              <button
                onClick={() => onWithdraw?.()}
                className="w-full flex items-center justify-between bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-blue-400" />
                  <span className="text-white font-bold text-sm">Withdraw</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>
              {/* Transactions */}
              <button
                onClick={() => setView("transactions")}
                className="w-full flex items-center justify-between bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Receipt className="w-5 h-5 text-green-400" />
                  <span className="text-white font-bold text-sm">Transactions</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>

              {/* Legal Info */}
              <button
                onClick={() => setView("legal")}
                className="w-full flex items-center justify-between bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-purple-400" />
                  <span className="text-white font-bold text-sm">Legal & Info</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>
            </div>
          )}

          {/* ─── Transactions View ─── */}
          {view === "transactions" && (
            <div className="px-5 py-4">
              {txLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                </div>
              ) : withdrawals.length === 0 ? (
                <div className="text-center py-10 text-white/30 text-sm">No transactions yet.</div>
              ) : (
                <div className="space-y-2">
                  {withdrawals.map((w: any) => (
                    <div key={w.id} className="bg-white/5 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(w.status)}
                        <div>
                          <p className="text-white text-xs font-bold">{w.method || "Withdrawal"}</p>
                          <p className="text-white/40 text-[10px] mt-0.5">
                            {w.createdAt ? format(new Date(w.createdAt), "dd MMM yyyy") : "—"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-white text-xs font-bold">{parseFloat(w.amount || "0").toLocaleString()} GRM</p>
                        <p className={`text-[10px] font-semibold capitalize ${getStatusColor(w.status)}`}>{w.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Legal View ─── */}
          {view === "legal" && !selectedLegal && (
            <div className="px-5 py-4 space-y-3">
              {([
                { id: "terms" as LegalDocument, label: "Terms & Conditions", icon: Shield, color: "text-emerald-400" },
                { id: "privacy" as LegalDocument, label: "Privacy Policy", icon: ScrollText, color: "text-orange-400" },
                { id: "acceptable" as LegalDocument, label: "Acceptable Use", icon: ShieldCheck, color: "text-rose-400" },
              ]).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => openLegalDocument(item.id)}
                    className="w-full flex items-center justify-between bg-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${item.color}`} />
                      <span className="text-white font-bold text-sm">{item.label}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                );
              })}
            </div>
          )}

          {view === "legal" && selectedLegal && (
            <div className="flex-1 overflow-y-auto p-6 text-gray-400 text-sm leading-relaxed">
              {selectedLegal === "terms" && (
                <div className="space-y-4">
                  <p className="text-[#B9FF66] font-bold">Last Updated: January 21, 2026</p>
                  <p>Welcome to Money AXN. By accessing or using this app, you agree to comply with these Terms & Conditions. If you do not agree, please do not use the app.</p>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">1. Eligibility</h4><p>Users must be at least 13 years old. You represent that you are of legal age to form a binding contract. You are responsible for maintaining the confidentiality of your account and all activities that occur under your account.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">2. AXN Mining & Rewards</h4><p>Money AXN is a free AXN mining application. Users can mine AXN tokens through free mining activities and boost their mining speed through optional investments. Mined AXN is credited to your virtual balance and can be converted to TON for withdrawal.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">3. Mining Boost & Investment</h4><p>Users can optionally invest TON to boost their mining speed. Mining boosts are time-limited and increase the rate at which AXN is mined. Investment in mining boosts is voluntary and subject to the terms displayed at the time of purchase.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">4. Withdrawals</h4><p>AXN tokens can be converted to TON and withdrawn to your personal wallet. Withdrawals are subject to system verification, minimum limits, and available liquidity. Users must provide valid wallet addresses. We reserve the right to delay or cancel withdrawals for security audits or suspected fraudulent activity.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">5. Account Suspension & Bans</h4><p>We reserve the right to suspend or permanently ban accounts without prior notice if we detect violations of our policies, including multiple accounts, bot usage, script automation, or exploitation of system bugs.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">6. Fraud & Abuse</h4><p>Any attempt to manipulate the mining system, exploit technical vulnerabilities, or provide false information during verification will result in immediate termination of the account and forfeiture of accumulated rewards.</p></div>
                </div>
              )}
              {selectedLegal === "privacy" && (
                <div className="space-y-4">
                  <p>Money AXN respects your privacy and is committed to protecting your personal data.</p>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">1. Data Collection</h4><p>We collect essential data to provide our AXN mining services, including your Telegram User ID (UID), device information, IP address, app usage statistics, and mining activity history.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">2. Data Storage & Security</h4><p>Your data is stored securely using industry-standard encryption. We retain your information for as long as your account is active or as needed to provide our services and comply with legal obligations.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">3. Third-Party Services</h4><p>We integrate with third-party payment gateways for processing TON transactions. These services may collect non-personal data according to their own privacy policies for transaction processing.</p></div>
                  <div><h4 className="text-white font-bold mb-1 italic uppercase tracking-tighter">4. Your Rights</h4><p>You have the right to access, correct, or request the deletion of your data. Contact our support team for privacy-related inquiries.</p></div>
                </div>
              )}
              {selectedLegal === "acceptable" && (
                <div className="space-y-4">
                  <p>To maintain a fair AXN mining ecosystem for all users, you must adhere to the following rules:</p>
                  <div><h4 className="text-rose-400 font-bold mb-1 italic uppercase tracking-tighter">Prohibited Actions</h4><ul className="list-disc pl-5 space-y-1"><li>Creating or managing multiple accounts for a single user.</li><li>Using automated bots, scripts, or third-party software to simulate mining activity.</li><li>Exploiting technical vulnerabilities or bugs for unauthorized gain.</li><li>Attempting to manipulate AXN mining or conversion rates.</li><li>Reverse-engineering, decompiling, or attempting to extract source code.</li></ul></div>
                  <div><h4 className="text-white font-bold mb-1 flex items-center gap-2 italic uppercase tracking-tighter"><ShieldCheck className="w-4 h-4 text-[#B9FF66]" />Multi-Account Abuse</h4><p>Our system employs advanced detection for multi-account activity. Users found operating multiple profiles to inflate referral rewards or mining earnings will face permanent bans across all linked accounts.</p></div>
                  <div><h4 className="text-white font-bold mb-1 flex items-center gap-2 italic uppercase tracking-tighter"><CheckCircle className="w-4 h-4 text-green-500" />Compliance</h4><p>All users must use the app in compliance with applicable local and international laws. We cooperate with law enforcement agencies in cases of suspected illegal activity.</p></div>
                </div>
              )}
            </div>
          )}

          {view === "legal" && selectedLegal && (
            <div className="p-6 border-t border-white/5">
              <button
                className="w-full h-14 bg-[#1b1b1b] border border-white/5 rounded-2xl font-black uppercase italic tracking-wider text-white"
                onClick={closeLegalDocument}
              >
                Back
              </button>
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
                    Tell others about Lightning GRM, and get up to{" "}
                    <span className="text-[#F5C542]">10,000,000 GRM</span> for each video.
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
                  <p className="text-white/50 text-[11px] leading-relaxed pl-7">Make a fun video about Lightning GRM and post it on:</p>
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
                        <span className="text-[#F5C542] font-bold">10,000,000 GRM</span> per video.
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
              {/* Back to Contest Info is kept for the compact popup only. */}
              {!(fullScreen || contestFullScreen) && (
                <button
                  onClick={() => { resetContestForm(); }}
                  className="flex items-center gap-1.5 text-white/40 text-xs hover:text-white/60 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              )}

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

          {contestFullScreen && view === "contest" ? (
            <div className="p-6 border-t border-white/5">
              <button
                className="w-full h-14 bg-[#1b1b1b] border border-white/5 rounded-2xl font-black uppercase italic tracking-wider text-white"
                onClick={() => { setContestFullScreen(false); setView("main"); resetContestForm(); }}
              >
                Back
              </button>
            </div>
          ) : (
            <div className="h-6" />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
