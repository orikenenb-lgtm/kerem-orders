import HomeGate from "./components/HomeGate";

// The flag branch lives in HomeGate (a client component): inside a client
// boundary, next/dynamic is a真 lazy React.lazy chunk — with ff_new_landing
// on, the legacy chunk (ScrollHero + framer-motion, ~112KB gz of "/" JS) is
// never fetched. From a server component, dynamic() still lands in the page
// manifest and gets preloaded, which kept the old hero in every visitor's
// first load even though only LandingV2 rendered.
export default function Home() {
  return <HomeGate />;
}
