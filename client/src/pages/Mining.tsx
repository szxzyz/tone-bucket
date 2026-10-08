import Layout from "@/components/Layout";
import GameFarmingSection from "@/components/GameFarmingSection";

export default function Mining() {
  return (
    <Layout>
      <main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-[28px] text-white bg-black">
        <GameFarmingSection />
      </main>
    </Layout>
  );
}
