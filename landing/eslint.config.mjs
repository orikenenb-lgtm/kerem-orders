// ESLint flat config for Next 16. `next lint` was removed in Next 16 — the
// ESLint CLI with eslint-config-next replaces it, and since v16 the config
// ships native flat presets (no FlatCompat needed).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Generated / third-party output only — the whole source tree stays linted.
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // The whole app fetches in effects and mirrors the result into state —
      // the established (and tested) pattern here. The new hooks-v6 rule
      // flags every such site (28 of them); refactoring all data flow to
      // silence it would be a large behavioral risk for zero user value.
      // Keep the signal visible as warnings instead of failing CI.
      "react-hooks/set-state-in-effect": "warn",
      // Advisory for React Compiler, which this project does not enable.
      "react-hooks/preserve-manual-memoization": "warn",
      // Deliberate plain <img>: static export with images.unoptimized, all
      // product images already resized/cached by the rivhit-img edge proxy —
      // next/image adds nothing here. The flat preset registers the plugin
      // as @next/next, so that is the only valid rule key.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
