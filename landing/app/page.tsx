import ScrollHero from "./components/ScrollHero";
import FeaturesSection from "./components/FeaturesSection";
import NumbersSection from "./components/NumbersSection";
import ClosingCTA from "./components/ClosingCTA";

export default function Home() {
  return (
    <main style={{ background: "#fff" }}>
      <ScrollHero />
      <FeaturesSection />
      <NumbersSection />
      <ClosingCTA />
    </main>
  );
}
