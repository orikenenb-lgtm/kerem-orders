import { defineConfig, devices } from "@playwright/test";

// E2E harness for the public, read-only surface of the site. It runs against
// the STAGING Supabase project only — never production, never any write path.
//
// The site is a Next.js static export (`output: "export"`). Production builds
// apply the `/kerem-orders` basePath (see next.config.ts), and scripts/serve-out.mjs
// mounts ./out under that same basePath, mirroring GitHub Pages. So the whole
// app lives under http://localhost:<port>/kerem-orders/.
//
// webServer strategy: build once, then serve. `next build` for a static export
// is deterministic and there is no dev server to keep warm, so a single build
// into ./out followed by the tiny static server is the most reliable combo in
// CI-like containers (no long-lived Next runtime, no HMR flakiness). The build
// receives the staging NEXT_PUBLIC_* values so the exported bundle talks to
// staging. Set E2E_REUSE_BUILD=1 to skip the rebuild and serve an existing
// ./out (fast local re-runs).

const PORT = Number(process.env.E2E_PORT ?? 8735);
const BASE_PATH = "/kerem-orders";
// NOTE the trailing slash. Without it, `page.goto("/catalog/")` resolves
// against the ORIGIN and silently drops the /kerem-orders basePath, serving
// the static server's error page instead of the app. Specs therefore use
// RELATIVE paths ("catalog/"), never a leading slash.
const baseURL = `http://127.0.0.1:${PORT}${BASE_PATH}/`;

// Staging Supabase (publishable/anon key — public client key, RLS-enforced).
// Real values come from the environment (e.g. sourced from .env.e2e); these
// defaults match .env.e2e.example so the harness runs out of the box.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://ahptrtlnrpmevlpgqeac.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_OUA6ExlgitE1YOKkxjj4wQ_UlWuxZRb";

const buildAndServe =
  `sh -c '${process.env.E2E_REUSE_BUILD ? "true" : "npm run build"} && npm run serve'`;

export default defineConfig({
  testDir: "e2e",
  // No test writes anything, but keep runs isolated and deterministic.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    baseURL,
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The container ships a pinned Chromium; do NOT run `playwright install`.
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
        },
      },
    },
  ],

  webServer: {
    command: buildAndServe,
    url: baseURL + "/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    },
  },
});
