import * as Dialog from "@radix-ui/react-dialog";
import {
  CaretUpDown,
  Check,
  ClockCounterClockwise,
  Cpu,
  Flask,
  FlowArrow,
  GearSix,
  Gauge,
  ListChecks,
  Lock,
  Moon,
  NotePencil,
  Package,
  SidebarSimple,
  SquaresFour,
  Sun,
  Waveform,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "wouter";
import { Hint, cx } from "../components/ui";
import { NAV, STEPS, useDoctor, usePanel, useSettings, useWorkspace, viewPath, type ViewSlug } from "../data";
import { local } from "../format";
import { SPRING } from "../motion";
import { setTheme, useMediaQuery, type Theme } from "../theme";
import { Mark, STATUS_WORDS, useSwitcher } from "./TitleBar";
import { useStages } from "./stages";

export const VIEW_ICONS: Record<ViewSlug, PhosphorIcon> = {
  dashboard: Gauge,
  spec: NotePencil,
  targets: Cpu,
  dataset: Waveform,
  design: FlowArrow,
  training: Flask,
  benchmark: SquaresFour,
  deploy: Package,
  runs: ClockCounterClockwise,
  decisions: ListChecks,
};

const ASSISTANT: Record<string, string> = { off: "Rules only", claude_code: "Claude Code", claude_chat: "Claude chat" };

export interface ItemState {
  live?: boolean;
  waiting?: boolean;
  done?: boolean;
  locked?: boolean;
}

/** A small state mark at the end of a row: running, waiting for review, done or locked. */
export function StateMark({ live, waiting, done, locked }: ItemState) {
  if (live) return <span className="spinner !h-3 !w-3 !border-[1.5px]" aria-label="Running" />;
  if (waiting) return <span className="h-2 w-2 rounded-full bg-warn" aria-label="Needs review" />;
  if (done) return <Check size={12} weight="bold" className="text-ok" aria-label="Done" />;
  if (locked) return <Lock size={11} className="text-ink-3" aria-label="Locked" />;
  return <span className="h-2 w-2 rounded-full border border-line-strong" aria-label="Not done yet" />;
}

/** State of every sidebar item, derived from the stages. Pipeline design is ready once a model is chosen. */
export function useNavState(): Record<ViewSlug, ItemState> {
  const ws = useWorkspace();
  const stages = useStages();
  const out = {} as Record<ViewSlug, ItemState>;
  for (const n of NAV) {
    const s = n.step ? stages.find((x) => x.key === n.step) : undefined;
    out[n.slug] = s
      ? { live: s.live, waiting: s.waiting, done: s.state === "done" || s.state === "skipped", locked: s.state === "locked" }
      : {};
  }
  out.design = { done: ws.data.candidates.some((c) => c.selected), locked: !ws.data.dataset };
  return out;
}

export function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "w") + (words[1]?.[0] ?? "")).toUpperCase();
}

function SidebarBody({ onNavigate, onCollapse }: { onNavigate?: () => void; onCollapse?: () => void }) {
  const ws = useWorkspace();
  const stages = useStages();
  const state = useNavState();
  const switcher = useSwitcher();
  const d = ws.data;
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;

  const flow = NAV.filter((n) => n.group === "flow");
  const stepNo = (slug: ViewSlug) => STEPS.findIndex((x) => x.slug === slug) + 1;

  const item = (slug: ViewSlug, title: string) => {
    const Icon = VIEW_ICONS[slug];
    const st = state[slug];
    const n = stepNo(slug);
    const child = !!NAV.find((x) => x.slug === slug)?.parent;
    const current = ws.view === slug;
    const end =
      slug === "dashboard" ? (
        <span className="font-mono text-[11px] text-ink-3">
          {done}/{STEPS.length}
        </span>
      ) : slug === "runs" ? (
        d.active_job ? (
          <StateMark live />
        ) : d.jobs.length ? (
          <span className={cx("font-mono text-[11px]", d.jobs[0].status === "failed" ? "text-block" : "text-ink-3")}>{d.jobs.length}</span>
        ) : null
      ) : slug === "decisions" ? (
        d.pending_decisions.length ? (
          <span className="font-mono text-[11px] text-warn">{d.pending_decisions.length}</span>
        ) : null
      ) : n ? (
        st.live ? (
          <StateMark live />
        ) : st.waiting ? (
          <StateMark waiting />
        ) : null
      ) : (
        <StateMark {...st} />
      );
    const cls = cx(
      "relative flex h-9 items-center gap-3 rounded-[8px] pl-3 pr-2.5 text-[13.5px]",
      child && "ml-[34px] h-8 pl-2.5 text-[13px]",
      current ? "bg-signal-wash font-medium text-signal-text" : st.locked ? "text-ink-3" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
    );
    const lead = n ? (
      <span
        className={cx(
          "relative z-[1] grid h-[22px] w-[22px] flex-none place-items-center rounded-full border font-mono text-[11px] font-semibold",
          st.done
            ? "border-ok bg-ok text-on-ink"
            : current
              ? "border-signal bg-surface text-signal-text"
              : st.locked
                ? "border-line bg-pane text-ink-3"
                : "border-line-strong bg-pane text-ink-2",
        )}
        aria-label={st.done ? "Done" : st.locked ? "Locked" : undefined}
      >
        {st.done ? <Check size={12} weight="bold" /> : st.locked ? <Lock size={10} /> : n}
      </span>
    ) : (
      <Icon size={child ? 15 : 17} weight={current ? "fill" : "regular"} className={cx("flex-none", !child && "mx-[2.5px]")} />
    );
    const body = (
      <>
        {current && !child ? (
          <motion.span
            layoutId="nav-bar"
            transition={SPRING}
            className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-full bg-signal"
            aria-hidden
          />
        ) : null}
        {lead}
        <span className="min-w-0 grow truncate">{title}</span>
        <span className="grid min-w-3 flex-none place-items-center">{end}</span>
      </>
    );
    const parent = NAV.find((x) => x.slug === slug)?.parent;
    const continues = n ? flow.slice(flow.findIndex((x) => x.slug === slug) + 1).some((x) => stepNo(x.slug)) : !!parent;
    const lineDone = parent ? state[parent].done : st.done;
    return (
      <li key={slug} className="relative">
        {continues ? (
          <span
            className={cx(
              "absolute left-[22px] z-0 w-0.5 rounded-full",
              n ? "top-[27px] h-[calc(100%-18px)]" : "-top-px h-[calc(100%+9px)]",
              lineDone ? "bg-ok/70" : "bg-line",
            )}
            aria-hidden
          />
        ) : null}
        {st.locked ? (
          <span className={cls} aria-disabled title="Finish the earlier steps first">
            {body}
          </span>
        ) : (
          <Link
            href={viewPath(ws.pid, slug)}
            aria-current={current ? "page" : undefined}
            aria-label={n ? `${title}, step ${n} of ${STEPS.length}${st.done ? ", done" : st.waiting ? ", needs review" : ""}` : undefined}
            className={cls}
            onClick={onNavigate}
          >
            {body}
          </Link>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="flex h-14 flex-none items-center gap-2 px-4">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2 rounded-[6px]" aria-label="tinyml, all workspaces">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">tinyml</span>
        </Link>
        {onCollapse ? (
          <Hint label="Hide the sidebar  ⌘B">
            <button type="button" className="icon-btn ml-auto !h-7 !w-7" aria-label="Hide the sidebar" onClick={onCollapse}>
              <SidebarSimple size={16} />
            </button>
          </Hint>
        ) : null}
      </div>

      <div className="flex-none px-3 pb-3">
        <button
          type="button"
          onClick={switcher.open}
          className="flex w-full items-center gap-2.5 rounded-[9px] border border-line bg-surface-2 px-2.5 py-2 text-left hover:border-line-strong"
          aria-label={`Workspace: ${d.project.name}. Switch workspace`}
        >
          <span className="grid h-8 w-8 flex-none place-items-center rounded-[7px] bg-band font-mono text-[11px] font-semibold text-band-ink">
            {initials(d.project.name)}
          </span>
          <span className="min-w-0 grow">
            <span className="block truncate text-[13px] font-medium leading-tight">{d.project.name}</span>
            <span className="block text-[11.5px] leading-tight text-ink-3">{STATUS_WORDS[d.project.status] ?? d.project.status}</span>
          </span>
          <CaretUpDown size={14} className="flex-none text-ink-3" />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5 pl-2">{flow.map((n) => item(n.slug, n.title))}</ul>
        <div className="mx-2 my-3 border-t border-line" />
        <div className="mb-1 px-3 text-[11.5px] font-medium text-ink-3">History</div>
        <ul className="space-y-0.5 pl-2">{NAV.filter((n) => n.group === "history").map((n) => item(n.slug, n.title))}</ul>
      </div>

      <EngineFooter />
      {switcher.node}
    </>
  );
}

/** What this computer can do: the assistant mode and how many chips have a working toolchain. */
function EngineFooter() {
  const settings = useSettings();
  const doctor = useDoctor();
  const [theme, setThemeState] = useState<Theme>(() => local.get<Theme>("tinyml.theme", "light"));
  const chips = doctor.data?.chips ?? [];
  const ready = chips.filter((c) => c.ready).length;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <div className="flex flex-none items-center gap-2 border-t border-line px-4 py-3">
      <Link href="/settings" className="min-w-0 grow rounded-[6px] text-[11.5px] leading-snug" title="Open settings">
        <span className="block truncate text-ink-2">
          Assistant · <span className="text-ink">{ASSISTANT[settings.data?.assistant.provider ?? "off"]}</span>
        </span>
        <span className="block truncate text-ink-3">
          {doctor.isPending ? "Checking toolchains…" : `${ready} of ${chips.length} chips build here`}
        </span>
      </Link>
      <Hint label={dark ? "Light theme" : "Dark theme"}>
        <button
          type="button"
          className="icon-btn !h-7 !w-7"
          aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
          onClick={() => {
            const next: Theme = dark ? "light" : "dark";
            setTheme(next);
            setThemeState(next);
          }}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </Hint>
      <Hint label="Settings">
        <Link href="/settings" className="icon-btn !h-7 !w-7" aria-label="Settings">
          <GearSix size={15} />
        </Link>
      </Hint>
    </div>
  );
}

/** The project sidebar: a full-height column on wide screens, a drawer from the left below 1024 px. */
export function Sidebar() {
  const panel = usePanel();
  const wide = useMediaQuery("(min-width: 1024px)");
  if (wide) {
    if (!panel.railOpen) return null;
    return (
      <motion.nav
        aria-label="Workspace"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="flex w-[248px] flex-none flex-col border-r border-line bg-pane"
      >
        <SidebarBody onCollapse={() => panel.setRailOpen(false)} />
      </motion.nav>
    );
  }
  return (
    <Dialog.Root open={panel.navDrawer} onOpenChange={panel.setNavDrawer}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-overlay fixed inset-0 z-40 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="anim-drawer-left fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col border-r border-line bg-pane shadow-float"
        >
          <Dialog.Title className="sr-only">Sidebar</Dialog.Title>
          <nav aria-label="Workspace" className="flex min-h-0 grow flex-col">
            <SidebarBody onNavigate={() => panel.setNavDrawer(false)} />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
