import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  DownloadSimple,
  FolderSimple,
  GearSix,
  Keyboard,
  MagnifyingGlass,
  Moon,
  Pause,
  Play,
  Plus,
  SidebarSimple,
  Stop,
  Sun,
  TerminalWindow,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useJobControl, usePipelineActions } from "../actions";
import { errorMessage } from "../api";
import { toast } from "../components/Toast";
import { cx } from "../components/ui";
import { ACTIVE, JOB_TITLES, NAV, STEPS, usePanel, useProjects, useWorkspace, viewPath, type ViewSlug } from "../data";
import { setTheme } from "../theme";
import { VIEW_ICONS, useNavState } from "./Sidebar";

export interface Command {
  id: string;
  group: "Run" | "Go to" | "Review" | "Workspaces" | "View" | "Files";
  title: string;
  hint?: string;
  keys?: string;
  icon: PhosphorIcon;
  /** Why it cannot run now. Blocked commands stay listed so people learn what exists and what it needs. */
  blocked?: string | null;
  perform: () => unknown;
}

const GROUPS: Command["group"][] = ["Run", "Review", "Go to", "Files", "Workspaces", "View"];

/** Commands that make sense anywhere, including the workspace list. */
export function useGlobalCommands(): Command[] {
  const [, navigate] = useLocation();
  const panel = usePanel();
  return [
    { id: "new", group: "Workspaces", title: "New workspace", icon: Plus, perform: () => navigate("/new") },
    { id: "all", group: "Workspaces", title: "All workspaces", icon: FolderSimple, perform: () => navigate("/") },
    { id: "settings", group: "View", title: "Settings", icon: GearSix, perform: () => navigate("/settings") },
    { id: "dark", group: "View", title: "Dark theme", icon: Moon, perform: () => setTheme("dark") },
    { id: "light", group: "View", title: "Light theme", icon: Sun, perform: () => setTheme("light") },
    { id: "keys", group: "View", title: "Keyboard shortcuts", keys: "?", icon: Keyboard, perform: () => panel.setShortcuts(true) },
  ];
}

/** Commands for the open workspace: every view, every runnable stage, job controls, reviews and downloads. */
export function useWorkspaceCommands(): Command[] {
  const ws = useWorkspace();
  const panel = usePanel();
  const state = useNavState();
  const actions = usePipelineActions();
  const control = useJobControl();
  const projects = useProjects();
  const [, navigate] = useLocation();
  const d = ws.data;
  const job = d.active_job && ACTIVE.includes(d.active_job.status) ? d.active_job : null;
  const go = (v: ViewSlug) => () => navigate(viewPath(ws.pid, v));
  const locked = (v: ViewSlug) => !!state[v]?.locked;
  const build = d.builds.find((b) => b.passed && b.package_path);

  const list: Command[] = [];
  for (const a of actions) {
    list.push({
      id: `run-${a.id}`,
      group: "Run",
      title: a.title,
      hint: STEPS.find((s) => s.key === a.stage)?.title,
      icon: Play,
      blocked: a.blocked,
      perform: a.run,
    });
  }
  if (job) {
    const title = JOB_TITLES[job.kind] ?? job.kind;
    if (job.status === "queued" || job.status === "running")
      list.push({ id: "pause", group: "Run", title: `Pause ${title.toLowerCase()}`, icon: Pause, perform: () => control(job.id, "pause") });
    if (job.status === "paused" || job.status === "pausing")
      list.push({
        id: "resume",
        group: "Run",
        title: `Resume ${title.toLowerCase()}`,
        icon: Play,
        perform: () => control(job.id, "resume"),
      });
    if (job.status !== "cancelling")
      list.push({ id: "stop", group: "Run", title: `Stop ${title.toLowerCase()}`, icon: Stop, perform: () => control(job.id, "cancel") });
  }
  for (const r of d.reviews.filter((x) => x.status !== "approved"))
    list.push({
      id: `review-${r.stage}`,
      group: "Review",
      title: `Review ${r.title.toLowerCase()}`,
      hint: "Opens the review card",
      icon: ArrowRight,
      perform: () => panel.showReview(r.stage),
    });

  for (const n of NAV)
    list.push({
      id: `go-${n.slug}`,
      group: "Go to",
      title: n.title,
      hint: n.slug === "runs" ? `${d.jobs.length} in this workspace` : undefined,
      icon: VIEW_ICONS[n.slug],
      blocked: locked(n.slug) ? "Finish the earlier stages first" : null,
      perform: go(n.slug),
    });
  if (build) {
    list.push(
      {
        id: "dl-essentials",
        group: "Files",
        title: `Download .h and .c (v${build.version})`,
        hint: ws.chipName(build.chip_id),
        icon: DownloadSimple,
        perform: () => window.location.assign(`/api/builds/${build.id}/download/essentials`),
      },
      {
        id: "dl-full",
        group: "Files",
        title: `Download the full package (v${build.version})`,
        hint: "Library, example, report and signature",
        icon: DownloadSimple,
        perform: () => window.location.assign(`/api/builds/${build.id}/download`),
      },
    );
  }
  for (const p of (projects.data ?? []).filter((p) => p.id !== ws.pid).slice(0, 12))
    list.push({
      id: `ws-${p.id}`,
      group: "Workspaces",
      title: p.name,
      icon: FolderSimple,
      perform: () => navigate(viewPath(p.id, "dashboard")),
    });
  list.push(
    {
      id: "console",
      group: "View",
      title: panel.consoleOpen ? "Hide the console" : "Show the console",
      keys: "⌘J",
      icon: TerminalWindow,
      perform: () => panel.setConsoleOpen(!panel.consoleOpen),
    },
    {
      id: "assistant",
      group: "View",
      title: panel.open ? "Hide the assistant" : "Show the assistant",
      keys: "A",
      icon: SidebarSimple,
      perform: () => panel.setOpen(!panel.open),
    },
    {
      id: "explorer",
      group: "View",
      title: panel.railOpen ? "Hide the sidebar" : "Show the sidebar",
      keys: "⌘B",
      icon: SidebarSimple,
      perform: () => panel.setRailOpen(!panel.railOpen),
    },
  );
  return list;
}

function matches(c: Command, q: string) {
  const hay = `${c.title} ${c.hint ?? ""} ${c.group}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const panel = usePanel();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const hit = commands.filter((c) => matches(c, query));
    return GROUPS.flatMap((g) => hit.filter((c) => c.group === g));
  }, [commands, query]);
  const enabled = shown.map((c, i) => (c.blocked ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    setActive(enabled[0] ?? 0);
  }, [query, panel.palette]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const perform = async (c: Command) => {
    if (c.blocked) return;
    panel.setPalette(false);
    setQuery("");
    try {
      await c.perform();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const move = (dir: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + dir + enabled.length) % enabled.length]);
  };

  return (
    <Dialog.Root
      open={panel.palette}
      onOpenChange={(o) => {
        panel.setPalette(o);
        if (!o) setQuery("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="anim-overlay fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="anim-dialog fixed left-1/2 top-[12vh] z-50 flex max-h-[min(520px,76vh)] w-[calc(100vw-24px)] max-w-[620px] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-line bg-pane shadow-float"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              void perform(shown[active]);
            }
          }}
        >
          <Dialog.Title className="sr-only">Search and run commands</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <MagnifyingGlass size={16} className="flex-none text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 min-w-0 grow bg-transparent text-[14.5px] outline-none placeholder:text-ink-3"
              placeholder="Search views, runs and workspaces"
              aria-label="Search commands"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={shown[active] ? `cmd-${shown[active].id}` : undefined}
            />
            <kbd className="kbd">esc</kbd>
          </div>
          <ul id="palette-list" ref={list} role="listbox" className="min-h-0 grow overflow-y-auto p-1.5">
            {shown.length === 0 ? <li className="px-3 py-8 text-center text-[13px] text-ink-3">Nothing matches “{query}”.</li> : null}
            {shown.map((c, i) => {
              const Icon = c.icon;
              const head = i === 0 || shown[i - 1].group !== c.group;
              return (
                <li key={c.id} role="presentation">
                  {head ? <div className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-medium text-ink-3">{c.group}</div> : null}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={!!c.blocked}
                    data-index={i}
                    onMouseMove={() => !c.blocked && setActive(i)}
                    onClick={() => void perform(c)}
                    className={cx(
                      "flex min-h-10 items-center gap-3 rounded-[8px] px-2.5 py-1.5",
                      c.blocked ? "cursor-not-allowed" : "cursor-pointer",
                      i === active && !c.blocked && "bg-surface-2",
                    )}
                  >
                    <span
                      className={cx(
                        "grid h-7 w-7 flex-none place-items-center rounded-[7px] border border-line",
                        c.blocked ? "text-ink-3" : i === active ? "bg-surface-3 text-ink" : "text-ink-2",
                      )}
                    >
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 grow">
                      <span className={cx("block truncate text-[13px]", c.blocked ? "text-ink-3" : "font-medium text-ink")}>{c.title}</span>
                      {c.blocked || c.hint ? <span className="block truncate text-[12px] text-ink-3">{c.blocked ?? c.hint}</span> : null}
                    </span>
                    {c.keys ? <kbd className="kbd flex-none">{c.keys}</kbd> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-none items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
            <span>
              <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
            </span>
            <span>
              <kbd className="kbd">↵</kbd> run
            </span>
            <span className="ml-auto">{enabled.length} available</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
