import { CaretDown, CaretUp, Pause, Play, Stop, TerminalWindow } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { toast } from "../components/Toast";
import { Button, Confirm, Status, cx } from "../components/ui";
import { ACTIVE, JOB_TITLES, useAction, usePanel, useWorkspace } from "../data";
import { local, relativeTime } from "../format";
import { DURATION, EASE_OUT } from "../motion";
import type { Job } from "../types";

export const STATUS: Record<string, ["neutral" | "ok" | "warn" | "block" | "signal", string]> = {
  queued: ["neutral", "Queued"],
  running: ["signal", "Running"],
  pausing: ["warn", "Pausing"],
  paused: ["warn", "Paused"],
  cancelling: ["warn", "Stopping"],
  cancelled: ["neutral", "Cancelled"],
  done: ["ok", "Done"],
  failed: ["block", "Failed"],
};

export interface Line {
  t: string | null;
  text: string;
}

export function parse(log: string | null): Line[] {
  return (log ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const m = l.match(/^(\d\d:\d\d:\d\d) (.*)$/);
      return m ? { t: m[1], text: m[2] } : { t: null, text: l };
    });
}

const MIN = 140;
const MAX_RATIO = 0.7;

/** The bottom console: the selected job's real log, streaming while the job runs. */
export function Console() {
  const ws = useWorkspace();
  const panel = usePanel();
  const action = useAction();
  const [height, setHeight] = useState(() => local.get("tinyml.consoleHeight", 240));
  const [confirmStop, setConfirmStop] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const d = ws.data;
  const job: Job | undefined = (panel.consoleJob && d.jobs.find((j) => j.id === panel.consoleJob)) || d.active_job || d.jobs[0];
  const lines = parse(job?.log ?? null);
  const live = !!job && ACTIVE.includes(job.status);
  const open = panel.consoleOpen;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, open, job?.id]);

  useEffect(() => {
    pinned.current = true;
  }, [job?.id]);

  const startDrag = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const start = height;
    const move = (ev: PointerEvent) => {
      const next = Math.round(Math.min(window.innerHeight * MAX_RATIO, Math.max(MIN, start + (startY - ev.clientY))));
      setHeight(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setHeight((h) => {
        local.set("tinyml.consoleHeight", h);
        return h;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const control = (verb: "pause" | "resume" | "cancel") =>
    action.run(async () => {
      if (!job) return;
      await api(`/jobs/${job.id}/${verb}`, { json: {} });
      toast({ pause: "Pausing after the current step", resume: "Resumed", cancel: "Stopping after the current step" }[verb]);
      await ws.refresh();
    });

  const [tone, label]: (typeof STATUS)[string] = job ? (STATUS[job.status] ?? ["neutral", job.status]) : ["neutral", ""];

  return (
    <section
      aria-label="Console"
      className="relative flex flex-none flex-col overflow-hidden border-t border-line bg-pane"
      style={{ height: open ? `min(${height}px, 45dvh)` : 36 }}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the console"
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") setHeight((h) => Math.min(window.innerHeight * MAX_RATIO, h + 24));
            if (e.key === "ArrowDown") setHeight((h) => Math.max(MIN, h - 24));
          }}
          className="group absolute inset-x-3 top-0 z-10 h-2 cursor-row-resize"
        >
          <span className="absolute inset-x-0 top-0 h-[2px] rounded-full bg-transparent transition-colors group-hover:bg-signal group-focus-visible:bg-signal" />
        </div>
      ) : null}

      <div className="flex h-9 flex-none items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => panel.setConsoleOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded px-1 text-[12.5px] font-medium text-ink-2 hover:text-ink"
        >
          <TerminalWindow size={15} />
          Output
        </button>
        {job ? (
          <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span className="text-ink-3">·</span>
            <span className="truncate">{JOB_TITLES[job.kind] ?? job.kind}</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={job.status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: DURATION.fast }}
              >
                <Status tone={tone}>{label}</Status>
              </motion.span>
            </AnimatePresence>
            <span className="hidden text-ink-3 sm:inline">{live ? "" : relativeTime(job.updated_at)}</span>
          </span>
        ) : (
          <span className="text-[12.5px] text-ink-3">No runs yet</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {open && job && (job.status === "queued" || job.status === "running") ? (
            <Button size="sm" variant="ghost" icon={Pause} busy={action.busy} onClick={() => control("pause")}>
              Pause
            </Button>
          ) : null}
          {open && job && (job.status === "paused" || job.status === "pausing") ? (
            <Button size="sm" variant="ghost" icon={Play} busy={action.busy} onClick={() => control("resume")}>
              Resume
            </Button>
          ) : null}
          {open && live && job?.status !== "cancelling" ? (
            <Button size="sm" variant="ghost" icon={Stop} className="text-block" onClick={() => setConfirmStop(true)}>
              Stop
            </Button>
          ) : null}
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={open ? "Collapse the console" : "Expand the console"}
            onClick={() => panel.setConsoleOpen(!open)}
          >
            {open ? <CaretDown size={14} /> : <CaretUp size={14} />}
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className="min-h-0 grow overflow-y-auto border-t border-line px-3 py-2 font-mono text-[12px] leading-[1.7] [overflow-anchor:none]"
            role="log"
            aria-live="polite"
          >
            {!job ? (
              <p className="font-sans text-[13px] text-ink-3">Runs from the Model, Silicon and Deploy labs stream their output here.</p>
            ) : (
              <LogLines job={job} lines={lines} live={live} />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this run?"
        body="It stops after the current step. Builds that already finished are kept and reused next time."
        confirmLabel="Stop the run"
        danger
        onConfirm={() => control("cancel")}
      />
    </section>
  );
}

/** Log lines with their timestamps. New lines slide in; the newest carries a caret while the job writes. */
export function LogLines({ job, lines, live, query = "" }: { job: Job; lines: Line[]; live: boolean; query?: string }) {
  const q = query.trim().toLowerCase();
  const shown = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
  return (
    <ol>
      <AnimatePresence initial={false}>
        {shown.map((l, i) => {
          const last = !q && i === lines.length - 1 && live;
          return (
            <motion.li
              key={`${job.id}-${q ? lines.indexOf(l) : i}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              className={cx("flex gap-3", l.t ? "text-ink" : "pl-[72px] text-ink-3")}
            >
              {l.t ? <span className="flex-none select-none text-ink-3">{l.t}</span> : null}
              <span className={cx("min-w-0 whitespace-pre-wrap break-words", last && "text-signal-text")}>
                {q ? <Highlight text={l.text} q={q} /> : l.text}
                {last && job.status !== "paused" ? <span className="console-caret" aria-hidden /> : null}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
      {q && !shown.length ? <li className="font-sans text-[13px] text-ink-3">No line contains “{query}”.</li> : null}
      {job.status === "failed" && job.error ? <li className="mt-1 text-block">{job.error}</li> : null}
    </ol>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
    parts.push(
      text.slice(at, i),
      <mark key={i} className="rounded-[2px] bg-signal-wash text-signal-text">
        {text.slice(i, i + q.length)}
      </mark>,
    );
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
