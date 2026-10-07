import Layout from "@/components/Layout";
import GameFarmingSection from "@/components/GameFarmingSection";

export default function Mining() {
  return (
    <Layout>
      <main className="max-w-md mx-auto min-h-full px-4 pt-3 pb-24 text-white bg-black">
        <header className="mb-4 px-1">
          <h1 className="m-0 text-xl font-black text-white">Mining</h1>
          <p className="m-0 mt-1 text-xs text-white/45">Start a cycle, collect AXN, and upgrade your mining boost.</p>
        </header>
        <GameFarmingSection />
      </main>
    </Layout>
  );
}
