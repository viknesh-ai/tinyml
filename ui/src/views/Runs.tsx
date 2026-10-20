import { ClockCounterClockwise, Copy, DownloadSimple, MagnifyingGlass, Pause, Play, Stop } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { useJobControl } from "../actions";
import { toast } from "../components/Toast";
import { Button, Confirm, Empty, PageHeader, Segmented, Status, cx } from "../components/ui";
import { ACTIVE, JOB_TITLES, historyTabs, useAction, usePanel, useWorkspace } from "../data";
import { relativeTime } from "../format";
import { DURATION, EASE_OUT } from "../motion";
import { LogLines, STATUS, parse } from "../shell/Console";
import type { Job } from "../types";

type Filter = "all" | "live" | "done" | "failed";

function duration(a: string, b: string) {
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const pick: Record<Filter, (j: Job) => boolean> = {
  all: () => true,
  live: (j) => ACTIVE.includes(j.status),
  done: (j) => j.status === "done",
  failed: (j) => j.status === "failed" || j.status === "cancelled",
};

export function Runs() {
  const ws = useWorkspace();
  const panel = usePanel();
  const calm = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
  const jobs = ws.data.jobs;
  const shown = jobs.filter(pick[filter]);
  const selected = (panel.consoleJob && jobs.find((j) => j.id === panel.consoleJob)) || ws.data.active_job || jobs[0];

  return (
    <div>
      <PageHeader title="Runs" tabs={historyTabs(ws.pid, "runs", jobs.length)} />
      {!jobs.length ? (
        <Empty icon={ClockCounterClockwise} title="No runs yet">
          Training, Benchmark and Deployment each start a run.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
          <section aria-label="Runs" className="panel min-w-0 self-start overflow-hidden">
            <div className="border-b border-line p-2.5">
              <Segmented
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  ["all", `All ${jobs.length}`],
                  ["live", "Running"],
                  ["done", "Done"],
                  ["failed", "Stopped"],
                ]}
              />
            </div>
            {shown.length ? (
              <ul className="max-h-[62vh] divide-y divide-line overflow-y-auto">
                {shown.map((j, i) => {
                  const [tone, word] = STATUS[j.status] ?? ["neutral", j.status];
                  const on = selected?.id === j.id;
                  return (
                    <motion.li
                      key={j.id}
                      initial={calm ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: Math.min(i, 10) * 0.025 }}
                    >
                      <button
                        type="button"
                        onClick={() => panel.selectJob(j.id)}
                        aria-pressed={on}
                        className={cx("relative block w-full px-4 py-3 text-left", on ? "bg-signal-wash" : "hover:bg-surface-2")}
                      >
                        {on ? <span className="absolute inset-y-0 left-0 w-[3px] bg-signal" aria-hidden /> : null}
                        <span className="flex items-center gap-2">
                          <span className="grow text-[13.5px] font-medium">{JOB_TITLES[j.kind] ?? j.kind}</span>
                          <Status tone={tone}>
                            {j.status === "running" ? <span className="spinner !h-2.5 !w-2.5 !border-[1.5px]" /> : null}
                            {word}
                          </Status>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                          {[
                            j.params?.chip_id ? ws.chipName(j.params.chip_id) : null,
                            relativeTime(j.created_at),
                            duration(j.created_at, j.updated_at),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-[13px] text-ink-3">No runs match this filter.</p>
            )}
          </section>
          {selected ? <RunLog key={selected.id} job={selected} /> : null}
        </div>
      )}
    </div>
  );
}

/** One run's full log on a dark panel, with search, copy, download and the run controls. */
function RunLog({ job }: { job: Job }) {
  const ws = useWorkspace();
  const control = useJobControl();
  const action = useAction();
  const [query, setQuery] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lines = parse(job.log);
  const live = ACTIVE.includes(job.status);
  const [tone, word] = STATUS[job.status] ?? ["neutral", job.status];
  const title = JOB_TITLES[job.kind] ?? job.kind;
  const text = job.log ?? "";

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current && !query) el.scrollTop = el.scrollHeight;
  }, [lines.length, query]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Log copied");
    } catch {
      toast("The browser did not allow copying. Select the text instead.", "error");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${job.id}.log` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label={`${title} log`} className="term min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0 grow">
          <div className="flex items-center gap-2">
            <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>
            <Status tone={tone}>{word}</Status>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3">
            {[
              job.id,
              job.params?.chip_id ? ws.chipName(job.params.chip_id) : null,
              `started ${relativeTime(job.created_at)}`,
              duration(job.created_at, job.updated_at),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {job.status === "queued" || job.status === "running" ? (
            <Button size="sm" icon={Pause} busy={action.busy} onClick={() => action.run(() => control(job.id, "pause"))}>
              Pause
            </Button>
          ) : null}
          {job.status === "paused" || job.status === "pausing" ? (
            <Button size="sm" icon={Play} busy={action.busy} onClick={() => action.run(() => control(job.id, "resume"))}>
              Resume
            </Button>
          ) : null}
          {live && job.status !== "cancelling" ? (
            <Button size="sm" icon={Stop} className="!text-block" onClick={() => setConfirmStop(true)}>
              Stop
            </Button>
          ) : null}
          <button
            type="button"
            className="icon-btn !h-8 !w-8"
            aria-label="Copy the log"
            title="Copy the log"
            onClick={copy}
            disabled={!text}
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            className="icon-btn !h-8 !w-8"
            aria-label="Download the log"
            title="Download the log"
            onClick={download}
            disabled={!text}
          >
            <DownloadSimple size={15} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <MagnifyingGlass size={14} className="flex-none text-ink-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter lines"
          aria-label="Filter the log"
          className="h-7 min-w-0 grow bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <span className="flex-none font-mono text-[11px] text-ink-3">{lines.length} lines</span>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="h-[min(58vh,560px)] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.75] [overflow-anchor:none]"
        role="log"
        aria-live={live ? "polite" : "off"}
      >
        {lines.length ? (
          <LogLines job={job} lines={lines} live={live} query={query} />
        ) : (
          <p className="font-sans text-[13px] text-ink-3">{live ? "Waiting for the first line…" : "This run wrote no output."}</p>
        )}
      </div>
      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this run?"
        body="It stops after the current step. Builds that already finished are kept and reused next time."
        confirmLabel="Stop the run"
        danger
        onConfirm={() => control(job.id, "cancel")}
      />
    </section>
  );
}
