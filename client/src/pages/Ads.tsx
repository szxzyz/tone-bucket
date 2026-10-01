import Layout from '@/components/Layout';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery } from '@tanstack/react-query';

export default function Ads() {
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <section aria-labelledby="viewing-ads-title" style={{ marginBottom: 12 }}>
          <h1 id="viewing-ads-title" style={{ margin: '0 0 3px', color: '#fff', fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>
            Viewing Ads
          </h1>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.4 }}>
            Get paid for watching short ads on Telegram.
          </p>
        </section>
        <AdWatchingSection user={user} hideTitle />
      </main>
    </Layout>
  );
}
