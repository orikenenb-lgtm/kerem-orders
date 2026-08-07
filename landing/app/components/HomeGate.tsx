"use client";

import dynamic from "next/dynamic";
import LandingV2 from "./LandingV2";
import { featureFlags } from "../../lib/featureFlags";

// Client-side gate for the landing page.
//
// Wave 1's flag decides which landing renders. The legacy page (ScrollHero's
// 120-frame scrub + framer-motion sections) is behind next/dynamic INSIDE a
// client component, which makes it a real lazy chunk: with ff_new_landing on
// the browser never downloads it. Flag off → the chunk loads and the original
// page renders exactly as before (its components were moved, not modified),
// so rollback remains a one-line flag flip. Nothing was deleted: ScrollHero,
// FeaturesSection, NumbersSection, ClosingCTA and all public/ hero assets are
// untouched.
const LegacyLanding = dynamic(() => import("./LegacyLanding"), {
  // The legacy page is fully client-driven (scroll scrub); while its chunk
  // streams in, show nothing rather than a mismatched skeleton.
  loading: () => null,
});

export default function HomeGate() {
  if (featureFlags.ff_new_landing) {
    return <LandingV2 />;
  }
  return <LegacyLanding />;
}
