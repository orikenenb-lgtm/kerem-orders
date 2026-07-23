import ScrollHero from "./components/ScrollHero";
import FeaturesSection from "./components/FeaturesSection";
import NumbersSection from "./components/NumbersSection";
import ClosingCTA from "./components/ClosingCTA";
import LandingV2 from "./components/LandingV2";
import { featureFlags } from "../lib/featureFlags";

export default function Home() {
  // Wave 1: the new clean landing screen. Flag off = the original page,
  // byte-for-byte identical behavior.
  if (featureFlags.ff_new_landing) {
    return <LandingV2 />;
  }
  return (
    <main style={{ background: "#fff" }}>
      <ScrollHero />
      <FeaturesSection />
      <NumbersSection />
      <ClosingCTA />
    </main>
  );
}
