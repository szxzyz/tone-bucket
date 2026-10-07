import Layout from "@/components/Layout";
import GameFarmingSection from "@/components/GameFarmingSection";
import MissionDailyRewards from "@/components/MissionDailyRewards";

export default function Mining() {
  return (
    <Layout>
      <main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-24 text-white bg-black">
        <header className="mb-4 px-1">
          <h1 className="m-0 text-xl font-black text-white">Mining</h1>
        </header>
        <GameFarmingSection />
        <section>
          <h2 style={{ margin: "0 0 3px 4px", color: "#fff", fontSize: 15, fontWeight: 800 }}>Daily Task</h2>
          <p style={{ margin: "0 0 8px 4px", color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
            Complete daily task and get rewards
          </p>
          <MissionDailyRewards />
        </section>
      </main>
    </Layout>
  );
}
