import Layout from '@/components/Layout';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery } from '@tanstack/react-query';

export default function Ads() {
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <AdWatchingSection user={user} hideTitle={false} />
      </main>
    </Layout>
  );
}
