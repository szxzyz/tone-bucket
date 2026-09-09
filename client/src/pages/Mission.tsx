import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';

export default function Mission() {
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <AdvertiserTaskFeed kind="social" title="Social Missions" subtitle="Complete channel and social tasks to earn rewards." />
        <AdvertiserTaskFeed kind="game" title="Game Missions" subtitle="Launch games and complete tasks to earn rewards." />
      </main>
    </Layout>
  );
}
