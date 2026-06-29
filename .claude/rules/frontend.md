# Frontend Conventions (Next.js + React + TS)

The UI lives in `landing/` — Next.js 15 (App Router), React 19, TypeScript.

## Language & direction
- Hebrew-first, RTL. Use logical CSS props (`margin-inline`, `padding-inline`, `start`/`end`) — never hardcode left/right.
- All UI strings in Hebrew; keep them centralized for easy editing.

## Theming
- Support dark and light mode. Read colors from theme tokens — no hardcoded hex in components.
- CRM palette: indigo + teal. Keep it consistent across the leads, sales-rep, and collections dashboards.

## Components
- TypeScript strict; type all props. No `any`.
- Small, composable components; keep shared UI together under `landing/app/` (or a `landing/components/` folder).
- CRM components prefixed `Crm*`, rendered only when the CRM feature flag is on.
- Accessibility basics: labels, visible focus states, keyboard navigation.

Use the `frontend` sub-agent for UI work.
