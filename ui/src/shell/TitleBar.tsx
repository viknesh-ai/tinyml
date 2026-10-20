import * as Popover from "@radix-ui/react-popover";
import {
  Bell,
  CaretRight,
  CheckCircle,
  Cpu,
  GearSix,
  List,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  SidebarSimple,
  Stop,
  TerminalWindow,
  WarningCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useJobControl } from "../actions";
import { Hint, Modal, cx } from "../components/ui";
import {
  ACTIVE,
  JOB_TITLES,
  navTitle,
  useAction,
  useOptionalWorkspace,
  usePanel,
  useProjects,
  useRecipes,
  useWorkspace,
  viewPath,
} from "../data";
import { relativeTime } from "../format";
import { DURATION, EASE_OUT, SPRING } from "../motion";
import { useMediaQuery } from "../theme";
import type { Job, Project } from "../types";

export const STATUS_WORDS: Record<string, string> = {
  described: "Specified",
  data_ready: "Dataset ready",
  needs_choice: "Below target",
  trained: "Trained",
  ranked: "Benchmarked",
  built: "Deployed",
  failed: "Needs attention",
};

export function useElapsed(since: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function RunStatus({ job }: { job: Job }) {
  const ws = useOptionalWorkspace()!;
  const action = useAction();
  const control = useJobControl();
  const elapsed = useElapsed(job.created_at);
  const paused = job.status === "paused" || job.status === "pausing";
  const go = (verb: "pause" | "resume" | "cancel") => action.run(() => control(job.id, verb));
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className="flex h-8 min-w-0 items-center gap-2 rounded-[8px] border border-line bg-pane pl-2.5 pr-1"
    >
      {paused ? <Pause size={12} weight="fill" className="flex-none text-warn" /> : <span className="spinner !h-3 !w-3 !border-[1.5px]" />}
      <Link
        href={viewPath(ws.pid, "runs")}
        className="hidden min-w-0 max-w-[260px] truncate text-left text-[12.5px] md:block"
        title="Open in Runs"
      >
        <span className="font-medium">{JOB_TITLES[job.kind] ?? job.kind}</span>
        <span className="text-ink-3"> · {job.status === "paused" ? "Paused" : job.step || "Starting"}</span>
      </Link>
      <span className="flex-none font-mono text-[11.5px] text-ink-3">{elapsed}</span>
      {job.status === "queued" || job.status === "running" ? (
        <Hint label="Pause after the current step">
          <button type="button" className="icon-btn !h-6 !w-6" aria-label="Pause" onClick={() => go("pause")} disabled={action.busy}>
            <Pause size={13} weight="fill" />
          </button>
        </Hint>
      ) : null}
      {paused ? (
        <Hint label="Resume">
          <button type="button" className="icon-btn !h-6 !w-6" aria-label="Resume" onClick={() => go("resume")} disabled={action.busy}>
            <Play size={13} weight="fill" />
          </button>
        </Hint>
      ) : null}
      {job.status !== "cancelling" ? (
        <Hint label="Stop after the current step">
          <button
            type="button"
            className="icon-btn !h-6 !w-6 text-block"
            aria-label="Stop"
            onClick={() => go("cancel")}
            disabled={action.busy}
          >
            <Stop size={13} weight="fill" />
          </button>
        </Hint>
      ) : null}
    </motion.div>
  );
}

/** Everything waiting on the person: open reviews, unconfirmed settings and a failed last run. */
function Inbox() {
  const ws = useOptionalWorkspace()!;
  const panel = usePanel();
  const [open, setOpen] = useState(false);
  const d = ws.data;
  const reviews = d.reviews.filter((r) => r.status !== "approved");
  const failed = d.jobs[0]?.status === "failed" ? d.jobs[0] : null;
  const count = reviews.length + d.pending_decisions.length + (failed ? 1 : 0);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="Inbox">
        <Popover.Trigger asChild>
          <button type="button" className="icon-btn relative" aria-label={`Inbox${count ? `, ${count} waiting` : ""}`}>
            <Bell size={17} />
            <AnimatePresence>
              {count ? (
                <motion.span
                  key={count}
                  initial={{ scale: 0.4 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={SPRING}
                  className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 font-mono text-[10px] font-medium text-on-ink"
                >
                  {count}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="anim-popover z-50 w-[min(360px,calc(100vw-24px))] rounded-[12px] border border-line bg-pane shadow-float"
        >
          <div className="flex items-center border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Inbox</span>
            <span className="ml-auto text-[12px] text-ink-3">{count ? `${count} waiting` : "Nothing waiting"}</span>
          </div>
          {count === 0 ? (
            <div className="flex items-center gap-2 px-4 py-5 text-[13px] text-ink-2">
              <CheckCircle size={16} className="text-ok" /> Every review is approved and every setting confirmed.
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-auto p-1.5">
              {failed ? (
                <li>
                  <Link
                    href={viewPath(ws.pid, "runs")}
                    onClick={() => {
                      panel.selectJob(failed.id);
                      setOpen(false);
                    }}
                    className="flex gap-2.5 rounded-[8px] px-2.5 py-2 hover:bg-surface-2"
                  >
                    <WarningCircle size={16} className="mt-0.5 flex-none text-block" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{JOB_TITLES[failed.kind] ?? failed.kind} failed</span>
                      <span className="block truncate text-[12px] text-ink-3">{failed.error ?? "Open the run to read its log"}</span>
                    </span>
                  </Link>
                </li>
              ) : null}
              {reviews.map((r) => (
                <li key={r.stage}>
                  <button
                    type="button"
                    onClick={() => {
                      panel.showReview(r.stage);
                      setOpen(false);
                    }}
                    className="flex w-full gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-2"
                  >
                    <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-warn" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{r.title}</span>
                      <span className="block text-[12px] text-ink-3">
                        {r.status === "changes_requested" ? "Changes requested" : "Waiting for your review"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {d.pending_decisions.length ? (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      panel.setOpen(true);
                      setOpen(false);
                    }}
                    className="flex w-full gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-2"
                  >
                    <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-ink-3" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {d.pending_decisions.length} unconfirmed {d.pending_decisions.length === 1 ? "setting" : "settings"}
                      </span>
                      <span className="block text-[12px] text-ink-3">The platform picked a value it is not sure of</span>
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The chip the project is aimed at, shown as a button that opens Targets. */
function TargetButton() {
  const ws = useWorkspace();
  const d = ws.data;
  const top = d.chip_results.filter((r) => r.rank).sort((a, b) => a.rank! - b.rank!)[0];
  const chip = d.builds[0]?.chip_id ?? top?.chip_id ?? ws.singleChip;
  const label = chip
    ? (ws.chip(chip)?.family ?? chip)
    : d.chip_ids.length
      ? `${d.chip_ids.length} chips`
      : d.project.spec?.vendor && d.project.spec.vendor !== "any"
        ? `Any ${ws.vendorName(d.project.spec.vendor)} chip`
        : "Any chip";
  return (
    <Link
      href={viewPath(ws.pid, "targets")}
      className="hidden h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] hover:border-line-strong md:flex"
      title="Open Targets"
    >
      <Cpu size={14} className="flex-none text-ink-3" />
      <span className="text-ink-3">Target</span>
      <span className="truncate font-medium">{label}</span>
    </Link>
  );
}

export function TitleBar() {
  const ws = useOptionalWorkspace();
  const panel = usePanel();
  const wide = useMediaQuery("(min-width: 1024px)");
  const assistantDocked = useMediaQuery("(min-width: 1280px)");
  const job = ws?.data.active_job && ACTIVE.includes(ws.data.active_job.status) ? ws.data.active_job : null;

  return (
    <header className="relative flex h-14 flex-none items-center gap-2 border-b border-line bg-pane px-2 sm:px-4">
      {ws && (!wide || !panel.railOpen) ? (
        wide ? (
          <Hint label="Show the sidebar  ⌘B">
            <button type="button" className="icon-btn" aria-label="Show the sidebar" onClick={() => panel.setRailOpen(true)}>
              <SidebarSimple size={17} />
            </button>
          </Hint>
        ) : (
          <button type="button" className="icon-btn" aria-label="Open the sidebar" onClick={() => panel.setNavDrawer(true)}>
            <List size={18} />
          </button>
        )
      ) : null}
      {!ws || !wide || !panel.railOpen ? (
        <Link href="/" className="flex flex-none items-center gap-2 rounded-[6px] px-1 py-1" aria-label="tinyml, all workspaces">
          <Mark />
          <span className={cx("text-[15px] font-semibold tracking-[-0.01em]", ws && "hidden sm:inline")}>tinyml</span>
        </Link>
      ) : null}
      {ws ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <Link href="/" className="hidden flex-none text-ink-3 hover:text-ink md:block">
            Workspaces
          </Link>
          <CaretRight size={11} className="hidden flex-none text-ink-3 md:block" />
          <span className="hidden min-w-0 max-w-[280px] truncate font-medium md:block">{ws.data.project.name}</span>
          <CaretRight size={11} className="hidden flex-none text-ink-3 md:block" />
          <span className="truncate font-medium md:font-normal md:text-ink-2">{navTitle(ws.view)}</span>
        </nav>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
        {ws ? <TargetButton /> : null}
        <AnimatePresence mode="wait">{job ? <RunStatus key={job.id} job={job} /> : null}</AnimatePresence>
        <button
          type="button"
          onClick={() => panel.setPalette(true)}
          className="hidden h-8 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-3 hover:border-line-strong hover:text-ink xl:flex"
          aria-label="Search and run commands"
        >
          <MagnifyingGlass size={14} />
          Search or run
          <kbd className="kbd !text-[10.5px]">⌘K</kbd>
        </button>
        <button type="button" className="icon-btn xl:hidden" aria-label="Search and run commands" onClick={() => panel.setPalette(true)}>
          <MagnifyingGlass size={17} />
        </button>
        {ws ? (
          <>
            <span className="hidden sm:contents">
              <Inbox />
            </span>
            {ws.view !== "runs" ? (
              <Hint label={`${panel.consoleOpen ? "Hide" : "Show"} the console  ⌘J`}>
                <button
                  type="button"
                  className={cx("icon-btn hidden sm:inline-grid", panel.consoleOpen && "bg-surface-2 text-ink")}
                  aria-label="Console"
                  aria-pressed={panel.consoleOpen}
                  onClick={() => panel.setConsoleOpen(!panel.consoleOpen)}
                >
                  <TerminalWindow size={17} />
                </button>
              </Hint>
            ) : null}
            <Hint label={`${panel.open ? "Hide" : "Show"} the assistant  A`}>
              <button
                type="button"
                className={cx("icon-btn", panel.open && assistantDocked && "bg-surface-2 text-ink")}
                aria-label="Assistant"
                aria-expanded={panel.open}
                aria-controls="assistant"
                onClick={() => panel.setOpen(!panel.open)}
              >
                <SidebarSimple size={17} mirrored />
              </button>
            </Hint>
          </>
        ) : (
          <Hint label="Settings">
            <Link href="/settings" className="icon-btn" aria-label="Settings">
              <GearSix size={17} />
            </Link>
          </Hint>
        )}
      </div>

      <AnimatePresence>
        {job && job.status !== "paused" ? (
          <motion.span
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] overflow-hidden"
            aria-hidden
          >
            <span className="progress-sweep absolute inset-y-0 w-1/3 bg-signal" />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

export function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="flex-none">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M5 17h5l3-8 4 14 3-10 2 4h5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Switcher({
  open,
  onOpenChange,
  projects,
  loading,
  currentPid,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: Project[];
  loading: boolean;
  currentPid: string | null;
  onPick: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const recipes = useRecipes();
  const recipeTitle = (id?: string) => recipes.data?.find((r) => r.id === id)?.title ?? "";
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => `${p.description} ${p.spec?.recipe ?? ""}`.toLowerCase().includes(q)) : projects;
  }, [projects, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Switch workspace">
      <div className="flex gap-2">
        <label className="relative grow">
          <span className="sr-only">Search workspaces</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input autoFocus className="field-input pl-8" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={() => onPick(null)}>
          <Plus size={14} weight="bold" />
          New workspace
        </button>
      </div>
      <div className="-mx-2 mt-3">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-6 text-ink-2">
            <span className="spinner" /> Loading workspaces…
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-6 text-ink-2">{projects.length ? `Nothing matches “${query}”.` : "No workspaces yet."}</p>
        ) : (
          <ul className="max-h-[52vh] overflow-auto">
            {shown.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: Math.min(i, 10) * 0.02 }}
              >
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className={cx(
                    "flex w-full flex-col gap-0.5 rounded-[8px] px-3 py-2.5 text-left hover:bg-surface-2",
                    p.id === currentPid && "bg-surface-2",
                  )}
                >
                  <span className="line-clamp-1 text-[13.5px] font-medium">{p.name}</span>
                  <span className="text-[12px] text-ink-3">
                    {[recipeTitle(p.spec?.recipe), STATUS_WORDS[p.status] ?? p.status, `updated ${relativeTime(p.updated_at)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Opens the workspace switcher from the explorer. */
export function useSwitcher() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const projects = useProjects();
  const ws = useOptionalWorkspace();
  const node = (
    <Switcher
      open={open}
      onOpenChange={setOpen}
      projects={projects.data ?? []}
      loading={projects.isPending}
      currentPid={ws?.pid ?? null}
      onPick={(id) => {
        setOpen(false);
        navigate(id ? viewPath(id, "dashboard") : "/new");
      }}
    />
  );
  return { open: () => setOpen(true), node };
}
