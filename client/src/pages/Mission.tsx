import Layout from "@/components/Layout";
import DailyMissionTasks from "@/components/DailyMissionTasks";
import AdvertiserTaskFeed from "@/components/AdvertiserTaskFeed";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

export default function Mission() {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1 justify-center mb-4">
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <div className="text-foreground font-medium">{t('loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto bg-black text-white flex flex-col h-full overflow-hidden relative">
        {/* Scrollable Mission Content */}
        <div className="flex-1 overflow-y-auto px-4 custom-scrollbar" style={{ paddingBottom: 'calc(var(--bottom-nav-height, 80px) + 20px)' }}>
          <DailyMissionTasks />

          <div className="mt-5">
            <AdvertiserTaskFeed
              kind="social"
              title="Social Tasks"
              subtitle="Complete social tasks and get rewards."
            />

            <AdvertiserTaskFeed
              kind="game"
              title="Game Task"
              subtitle="Launch game and get rewards"
            />
          </div>
        </div>
      </main>
    </Layout>
  );
}
