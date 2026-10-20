Owner: Dev C. The web app: React 19 and TypeScript, built with Vite, served by the FastAPI app from `ui/dist`.

- Stack: TanStack Query for server state and job polling, wouter with hash routes, Radix primitives for dialogs,
  tooltips and the switch, Tailwind v4 with the tokens in `src/styles.css`, Motion for animation (tokens in
  `src/motion.tsx`), Phosphor icons, Inter and IBM Plex Mono bundled from `@fontsource` (no network at runtime).
- Every animation needs a purpose written in the Motion table of `DESIGN.md`. Animate only transform and opacity,
  and check the page with reduced motion turned on.
- Format with `npm --prefix ui run format`; the build fails if Prettier would change anything.
- `src/api.ts` is the only place that calls `/api/*`. Types for every response live in `src/types.ts`.
- Read `DESIGN.md` before changing how anything looks. Keep the six steps in PRD order, show every engine
  number through `<Reading>` so it carries its `measured`/`emulated`/`estimated` tag, and keep ML jargon off the
  first three steps.
- Layout: `src/shell/` holds the sidebar, top bar, console, command palette and shortcuts; `src/views/` the
  launcher, dashboard, pipeline design and runs; `src/steps/` the pipeline stages. `src/actions.tsx` holds the
  rules for starting a stage, shared by the palette and the dashboard. Job output and pause, resume and stop
  live in the console, the top bar and Runs. The assistant panel (`src/panel/`) holds review cards, unconfirmed settings and Ask, and
  must keep working with the assistant off.
- Nothing is preloaded in the interface: no example objectives and no demo-data buttons. Demo CSVs come from
  `tinyml demo-data` on the command line.
- Develop with `npm --prefix ui run dev` next to `uv run tinyml serve`. Before committing, run `make ui` and
  commit `ui/dist` with the source; CI fails if they differ.
