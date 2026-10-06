import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import GameFarmingSection from "@/components/GameFarmingSection";

export default function Home() {
  const { isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  if (userLoading) {
    return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-white/50 text-sm">Loading…</div>;
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto min-h-full px-4 pt-4 pb-24 text-white bg-[#000]">
        <GameFarmingSection />
      </main>
    </Layout>
  );
}
