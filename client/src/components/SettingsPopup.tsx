import React from 'react';
import { X, Copy, Globe, MessageSquare, ShieldCheck, FileText, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { SUPPORTED_LANGUAGES, useLanguage } from '@/hooks/useLanguage';
import { showNotification } from '@/components/AppNotification';
import { useSupportLink } from '@/hooks/useSupportLink';

interface SettingsPopupProps {
  onClose: () => void;
}

export const SettingsPopup: React.FC<SettingsPopupProps> = ({ onClose }) => {
  const { user } = useAuth();
  const supportLink = useSupportLink();
  const { t } = useLanguage();
  const [copied, setCopied] = React.useState(false);

  const [selectedLegal, setSelectedLegal] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Lock scroll on mount
    document.body.style.overflow = 'hidden';
    return () => {
      // Restore scroll on unmount
      document.body.style.overflow = 'unset';
    };
  }, []);

  const uid = (user as any)?.referralCode || '00000';

  const legalContent: Record<string, { title: string, content: React.ReactNode }> = {
    terms: {
      title: t('terms_conditions'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p className="text-[#B9FF66] font-bold">{t('legal_last_updated')}</p>
          <p>{t('legal_terms_intro')}</p>
          <div><h4 className="text-white font-bold mb-1">{t('legal_terms_eligibility_title')}</h4><p>{t('legal_terms_eligibility')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_terms_rewards_title')}</h4><p>{t('legal_terms_gem')}</p><p className="mt-2">{t('legal_terms_referrals')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_terms_withdrawals_title')}</h4><p>{t('legal_terms_withdrawals')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_terms_fair_use_title')}</h4><p>{t('legal_terms_fair_use')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_terms_changes_title')}</h4><p>{t('legal_terms_changes')}</p></div>
        </div>
      ),
    },
    privacy: {
      title: t('privacy_policy'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p>{t('legal_privacy_intro')}</p>
          <div><h4 className="text-white font-bold mb-1">{t('legal_privacy_data_title')}</h4><p>{t('legal_privacy_data')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_privacy_wallet_title')}</h4><p>{t('legal_privacy_wallet')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_privacy_services_title')}</h4><p>{t('legal_privacy_services')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_privacy_retention_title')}</h4><p>{t('legal_privacy_retention')}</p></div>
          <div><h4 className="text-white font-bold mb-1">{t('legal_privacy_contact_title')}</h4><p>{t('legal_privacy_contact')}</p></div>
        </div>
      ),
    },
    acceptable: {
      title: t('acceptable_use'),
      content: (
        <div className="space-y-4 text-gray-300 text-sm">
          <p>{t('legal_acceptable_intro')}</p>
          <div>
            <h4 className="text-rose-400 font-bold mb-1 flex items-center gap-2"><X className="w-4 h-4" />{t('legal_acceptable_rules_title')}</h4>
            <p>{t('legal_acceptable_prohibited')}</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#B9FF66]" />{t('legal_acceptable_enforcement_title')}</h4>
            <p>{t('legal_acceptable_enforcement')}</p>
          </div>
        </div>
      ),
    },
  };

  const copyUid = () => {
    navigator.clipboard.writeText(uid);
    setCopied(true);
    showNotification(t('copied'), 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const openLink = (url: string) => {
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-[1300] animate-in fade-in duration-200 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="relative bg-[#0f0f0f] rounded-t-2xl w-full max-w-md max-h-[90vh] border border-white/10 overflow-hidden shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/5">
          <h2 className="text-white font-bold text-base">Settings</h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10">Close</button>
        </div>
        <div className="p-4 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            {/* My UID */}
            <LegalItem
              icon={<Copy className="w-4 h-4 text-[#6b21a8]" />}
              label={`${t('my_uid')}: ${uid}`}
              onClick={copyUid}
              rightIcon={copied ? <Check className="w-3 h-3 text-green-500" /> : null}
            />

            {/* Language */}
            <LanguagePreferenceControl />

            {/* Admin Panel (Conditional) */}
            {(user as any)?.isAdmin && (
              <LegalItem
                icon={<ShieldCheck className="w-4 h-4 text-red-500" />}
                label="Admin Panel"
                onClick={() => {
                  onClose();
                  window.location.href = '/admin';
                }}
              />
            )}

            {/* Contact Support */}
            <LegalItem
              icon={<MessageSquare className="w-4 h-4 text-blue-400" />}
              label={t('contact_support')}
              onClick={() => {
                if (!supportLink) { showNotification('Support link is not configured', 'error'); return; }
                openLink(supportLink);
              }}
            />

            {/* Legal Section */}
            <div className="pt-4 pb-2">
              <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-3 px-1">{t('legal_info')}</p>
              <div className="space-y-2">
                <LegalItem
                  icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
                  label={t('terms_conditions')}
                  onClick={() => setSelectedLegal('terms')}
                />
                <LegalItem
                  icon={<FileText className="w-4 h-4 text-orange-400" />}
                  label={t('privacy_policy')}
                  onClick={() => setSelectedLegal('privacy')}
                />
                <LegalItem
                  icon={<ShieldCheck className="w-4 h-4 text-rose-400" />}
                  label={t('acceptable_use')}
                  onClick={() => setSelectedLegal('acceptable')}
                />
              </div>
            </div>
          </div>

          <Button
            onClick={onClose}
            className="w-full mt-6 h-12 bg-gradient-to-r from-[#6b21a8] to-[#6b21a8] text-black font-bold rounded-xl shadow-[0_0_20px_rgba(76,211,255,0.3)]"
          >
            {t('close')}
          </Button>
        </div>
      </div>

      {/* Legal Detail Overlay */}
      {selectedLegal && (
        <div className="absolute inset-0 bg-[#0d0d0d] z-[110] animate-in slide-in-from-right duration-300">
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-[#1a1a1a] flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {selectedLegal === 'terms' && <ShieldCheck className="w-5 h-5 text-emerald-400" />}
                {selectedLegal === 'privacy' && <FileText className="w-5 h-5 text-orange-400" />}
                {selectedLegal === 'acceptable' && <ShieldCheck className="w-5 h-5 text-rose-400" />}
                {legalContent[selectedLegal].title}
              </h2>
              <button type="button" onClick={() => setSelectedLegal(null)} aria-label="Close legal document" className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 text-white/70 hover:bg-white/10 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {legalContent[selectedLegal].content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const LegalItem = ({ icon, label, onClick, rightIcon }: { icon: React.ReactNode, label: string, onClick?: () => void, rightIcon?: React.ReactNode }) => (
  <div
    onClick={onClick}
    className="bg-white/[0.05] rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-white/[0.08] transition-all active:scale-[0.98]"
  >
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center">
        {icon}
      </div>
      <span className="text-gray-300 text-xs font-medium">{label}</span>
    </div>
    {rightIcon}
  </div>
);

export const LanguagePreferenceControl: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const chooseLanguage = async (next: (typeof SUPPORTED_LANGUAGES)[number]['code']) => {
    setLanguage(next);
    try {
      await fetch('/api/user/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
        credentials: 'include',
      });
    } catch {
      // Local preference is already applied by useLanguage.
    }
  };

  return (
    <div className="space-y-2" aria-label={t('language')}>
      {SUPPORTED_LANGUAGES.map((item) => {
        const selected = language === item.code;
        return (
          <button
            key={item.code}
            type="button"
            aria-pressed={selected}
            onClick={() => void chooseLanguage(item.code)}
            className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors ${selected ? 'bg-[#0066D6]/20 text-white' : 'bg-white/[0.05] text-white/75 hover:bg-white/[0.09]'}`}
          >
            <span className="flex items-center gap-3">
              <span className="text-base leading-none">{item.flag}</span>
              <span className="truncate">{item.label}</span>
            </span>
            {selected && <Check className="w-4 h-4 text-[#60a5fa]" />}
          </button>
        );
      })}
    </div>
  );
};
