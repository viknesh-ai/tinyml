# tinyml UI direction

The agent wrote this direction from the owner's brief ("top notch, not a typical AI look, keep the pipeline
animation and the assistant panel"). Agent-written direction tends towards default taste, so treat it as a
starting point and change anything that does not feel like the product.

Reading this as: a local engineering studio where firmware and product engineers turn sensor recordings
into a verified C library. The owner's reference is Edge Impulse Studio, observed with REA browser captures of a public project: a project sidebar that lists the
whole flow in order, a dark band across the top of each page with its tabs and summary cards, a dataset of
recordings with waveform thumbnails, the pipeline drawn as blocks, and deployment with a resource table. We
follow that structure with our own palette, mark and wording, and none of its logo, names or artwork.
Dials: ENERGY 2 / RHYTHM 2 / MOTION 2.

## Identity

- **The page band.** Every page opens with a pale blue band holding the title, the tabs and up to four
  summary cards. It fades into the page with a slight vertical gradient, the one place a gradient is used.
- **One fact, one place.** A number appears once per page: in a summary card or in the table below it,
  never both. Page descriptions are one short sentence or none. The assistant panel starts closed; the
  inbox badge says when a review is waiting.
- **Copy.** Labels and values, as in an instrument panel ("Data collected 32.0 min", "Flash 1.5 KB").
  Real actors and active verbs, no "the platform" doing things, no slogans.
- **Datasheet rhythm.** Results read like a spec sheet, and every engine number carries its provenance mark
  (`measured`, `emulated`, `estimated`) through `<Reading>` (AGENTS.md rule 1).

## Palette

Light is the default, as in the reference; dark is kept and maintained. Every text pairing passes AA with the
antislop contrast script.

| token | light | dark | why |
|---|---|---|---|
| paper | `#f4f5f9` | `#0b0c0e` | the page behind the cards |
| surface / pane | `#ffffff` | `#16181c` / `#111216` | cards, the sidebar and the assistant |
| ink / ink-2 / ink-3 | `#1b2036` / `#485069` / `#5f6782` | `#eceef2` / `#b3b7c1` / `#8b909b` | text, secondary, muted |
| band | `#e6ebf7` to `#f4f5f9` | `#171a22` to `#0b0c0e` | the page band; ink text, `#4c5470` secondary |
| primary / signal | `#2f5bd8` | `#2f6bff` / `#4d8dff` | the primary action, the current page and live state |
| chart-bg | `#ffffff` | `#111216` | panels for signal plots and logs |
| series 1-4 | blue, green, orange, violet | brighter versions | signal axes and the pipeline blocks |
| ok / warn / block | `#157347` / `#ad4209` / `#b42318` | `#4cc38a` / `#ff9a5c` / `#ff6b5e` | status, always with an icon and words |

## Type

- Inter for the interface (the owner's references use it; neutral, compact and with tabular numbers at small
  sizes). IBM Plex Mono for part numbers, file names, code and measured values.
- No uppercase labels with wide letter spacing, and no monospace headings.

## Shape and depth

- Corners: 5 px on tags, 7 px on controls, 10 px on cards. Cards have a faint shadow in light, none in dark.
- Glow only on the pipeline block whose stage is training right now.

## Motion

Dial MOTION 2. Motion explains cause and effect: something arrived, something moved, something finished. It
never runs on a loop unless the server says a job is running. Rules, from Vercel's interface guidelines and
Emil Kowalski's animation notes: only `transform` and `opacity`, a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`)
under 300 ms for entrances, stiff springs for anything that travels so it can be interrupted, exits faster than
entrances, and everything collapses to an instant change under `prefers-reduced-motion`. Tokens live in
`src/motion.tsx`.

| what moves | why |
|---|---|
| Views slide 20 px from the side you are heading | Forward and back through the pipeline feel spatial, so you know which way you went |
| A finished stage draws its trace into the next stage, and its number turns into a check | Marks the moment a stage completes, which is the event the whole product is about |
| Pulse along the live trace segment | The only loop; it runs exactly while the server reports a running job |
| New job log lines slide into the timeline | You see progress arrive line by line, the way the work happens |
| Status labels pop when they change (Running, Paused, Approved) | Draws the eye to a state change you caused or are waiting for |
| Proof squares fill one by one | Each square is one golden window checked on the chip; the sequence reads as "verified, verified, verified" |
| Meters and score bars grow from zero | The eye follows the bar to the target mark, so "above or below target" reads at a glance |
| Results rise in, staggered 50 ms | A finished job's answer arrives as one event, most important block first |
| Sliding thumb on segmented controls and the chip-maker list | Confirms which option took the selection |
| Dialogs scale in from 96 %, the drawer slides in from the right, both animate out | Shows where the layer came from and where it went |
| Toasts spring up and slide away | Notice without interrupting; stacking reflows smoothly |
| Buttons press to 97 %, forward arrows nudge on hover | Tactile confirmation that a click registered, and a direction cue on the action that moves you on |
| Three-dot wave while the assistant thinks | Waiting has a visible cause |
| Drop zone border marches while a file is dragged over | Says "let go here" before you drop |
| Pipeline blocks rise in one after another, connectors draw in, a pulse travels between blocks while training runs | The pipeline reads as one flow from recording to output, and you see when it is being rebuilt |
| Title bar progress sweep and elapsed clock | A run is in progress somewhere, visible from every view |
| Console lines slide in, with a blinking caret on the newest line | Output arrives the way it is produced; the caret means the run is still writing |
| The sidebar's current-page bar and the band's tab highlight slide to the new page | Shows where you moved in the project |
| Choosing a recording swaps the signal panel with a short rise | Confirms which recording the big plot now shows |
| Comparison and budget bars grow from zero once, staggered 40 ms | Ranks read top to bottom, and "used of available" reads as a share before the numbers do |

## Layout

- **Workspaces** at `#/`: the list of projects and New workspace. Nothing is preloaded: no example objectives
  and no demo data in the interface.
- **Project** at `#/w/<id>/<page>`: the sidebar on the left (project switcher, Dashboard, then the six steps
  numbered 1 to 6 on a line that turns green as steps finish: Brief, Targets, Data, Training with Pipeline
  design under it, Benchmark, Deployment; then Runs and Decision log), a top bar (breadcrumb, Target chip, live run with pause and stop, search, inbox, console and
  assistant), the page, the console under it, and the assistant on the right.
- **Search or run** (⌘K) reaches every page, runs any stage the page itself would allow (with the reason
  when it cannot), pauses or stops the run, opens reviews and downloads the package. `?` lists the shortcuts.
- Every step ends in the same sticky footer: Back to the previous step, a short note on what comes next,
  and the one main action. A running stage shows its own banner with Pause, Resume, Stop and Output.
- Long steps split into tabs in the band instead of one long scroll: Training has Results, Methods and How it
  was tested.
- Headings are nouns, never questions. Below 1024 px the sidebar is a drawer; below 1280 px the assistant is
  a drawer. The console is capped at 45 % of the screen height.

## Charts

Taken from how embedded-ML studios show results (REA captures of a public Edge Impulse project's spectral
features, classifier, model testing and tuner pages: evidence `ev_70d514a9…`, `ev_83fc2f26…`, `ev_512f740b…`,
`ev_75f60a88…`), drawn with our tokens:

- Every plot has gridlines, tick labels, an axis title and a legend. Pointing at a plot (or focusing it and
  using the arrow keys) shows the values under the cursor; legend entries hide and show a line.
- Data shows each sample over time with one model window shaded, or as frequency content (the browser
  takes a Fourier transform of the preview; no engine number comes from it), plus time per label on one scale.
- Training shows the confusion matrix as shares of each row with counts underneath, recall per row and
  precision and F1 per column, next to a metrics table; the most useful measurement as a histogram that
  can switch between window counts and share of each label; and every method against the target.
- Benchmark compares the passing chips on one measure at a time, picked with a segmented control. Memory and
  time read as "used of available" bars, like a tuner card, here and on Deployment.
- Every engine number in a chart keeps its `measured`/`emulated`/`estimated` tag through `<Reading>`.

