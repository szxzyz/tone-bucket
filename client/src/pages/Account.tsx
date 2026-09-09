import { useLocation } from 'wouter';
import { ChevronRight, CircleHelp, Languages, Settings, List } from 'lucide-react';
import Layout from '@/components/Layout';
import { showNotification } from '@/components/AppNotification';

const cardStyle = { background: '#171717', borderRadius: 16, padding: 16 };

export default function Account() {
  const [, setLocation] = useLocation();

  const more = (name: string) => {
    if (name === 'Support') {
      const link = 'https://t.me/GrabPennySupportBot';
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.openTelegramLink) tg.openTelegramLink(link);
      else window.open(link, '_blank');
      return;
    }
    if (name === 'Settings') {
      setLocation('/profile');
      return;
    }
    showNotification(`${name} will be available soon`, 'info');
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 text-white" style={{ paddingTop: 18, paddingBottom: 110 }}>
        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 900, marginBottom: 10 }}>
            <List size={19} color="#c084fc" />
            More
          </div>
          {[['Settings', Settings], ['Support', CircleHelp], ['Languages', Languages]].map(([name, Icon]: any) => (
            <button
              key={name}
              onClick={() => more(name)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, height: 48, border: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', textAlign: 'left' }}
            >
              <Icon size={18} color="rgba(255,255,255,0.65)" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{name}</span>
              <ChevronRight size={17} color="rgba(255,255,255,0.35)" />
            </button>
          ))}
        </section>
      </main>
    </Layout>
  );
}
