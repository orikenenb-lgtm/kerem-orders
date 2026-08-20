"use client";

// The ORIGINAL landing page (pre-Wave-1), extracted verbatim from app/page.tsx
// so the flag-off path still renders it pixel-for-pixel — but from its own
// lazily-loaded chunk.
//
// Why it exists: page.tsx statically imported ScrollHero (whose 120-frame
// scrub animation dominates the route's JS) even when ff_new_landing was on
// and only LandingV2 rendered. Splitting the legacy path behind next/dynamic
// removes it from the "/" First-Load bundle while keeping rollback a
// one-line flag flip — nothing here was deleted or changed.
import ScrollHero from "./ScrollHero";
import FeaturesSection from "./FeaturesSection";
import NumbersSection from "./NumbersSection";
import ClosingCTA from "./ClosingCTA";

export default function LegacyLanding() {
  return (
    <main id="main-content" tabIndex={-1} style={{ background: "#fff" }}>
      <ScrollHero />
      <FeaturesSection />
      <NumbersSection />
      <ClosingCTA />
    </main>
  );
}
