import { Check, Pause } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { cx } from "../components/ui";
import { ACTIVE, STEPS, STEP_STAGE, useWorkspace, type StepKey } from "../data";
import { DURATION, EASE_OUT, SPRING } from "../motion";
import type { ProjectData } from "../types";

export type StationState = "locked" | "open" | "done" | "skipped";

export function stationState(key: StepKey, d: ProjectData): StationState {
  const selected = d.candidates.some((c) => c.selected);
  const done: Record<StepKey, boolean> = {
    describe: !!d.project.spec,
    target: !!d.dataset || d.chip_ids.length > 0,
    data: !!d.dataset && !d.dataset.issues.some((i) => i.severity === "block"),
    model: selected,
    rank: d.chip_results.some((r) => r.rank),
    build: d.builds.some((b) => b.passed),
  };
  const unlocked: Record<StepKey, boolean> = {
    describe: true,
    target: done.describe,
    data: done.describe,
    model: !!d.dataset,
    rank: selected,
    build: selected,
  };
  if (!unlocked[key]) return "locked";
  if (key === "rank" && d.chip_ids.length === 1) return "skipped";
  return done[key] ? "done" : "open";
}

export const JOB_STAGE: Record<string, StepKey> = { train: "model", select: "model", rank: "rank", build: "build" };

export interface StageInfo {
  key: StepKey;
  slug: string;
  title: string;
  index: number;
  state: StationState;
  live: boolean;
  paused: boolean;
  waiting: boolean;
  caption: string;
}

/** Status of every stage, shared by the explorer, the lab tabs and the workflow graph. */
export function useStages(): StageInfo[] {
  const { data: d } = useWorkspace();
  const job = d.active_job && ACTIVE.includes(d.active_job.status) ? d.active_job : null;
  const liveKey = job ? JOB_STAGE[job.kind] : null;
  return STEPS.map((s, index) => {
    const state = stationState(s.key, d);
    const stage = STEP_STAGE[s.key];
    const review = stage ? d.reviews.find((r) => r.stage === stage) : undefined;
    const waiting = !!review && review.status !== "approved";
    const live = s.key === liveKey;
    let caption: string = s.hint;
    if (live)
      caption = { paused: "Paused", pausing: "Pausing", cancelling: "Stopping", queued: "Queued" }[job!.status as string] ?? "Running";
    else if (state === "skipped") caption = "Skipped, one chip";
    else if (review?.status === "changes_requested") caption = "Changes requested";
    else if (waiting) caption = "Needs review";
    else if (state === "done") caption = "Done";
    else if (state === "locked") caption = "Waiting on earlier stages";
    return { key: s.key, slug: s.slug, title: s.title, index, state, live, paused: job?.status === "paused", waiting, caption };
  });
}

export function StageNode({ s, size = 22 }: { s: StageInfo; size?: number }) {
  return (
    <span
      className={cx(
        "relative grid flex-none place-items-center rounded-full border-[1.5px] font-mono text-[10.5px] font-medium transition-colors duration-300",
        s.state === "done" && !s.live && "border-ok bg-ok-wash text-ok",
        s.state === "open" && !s.live && "border-line-strong bg-surface text-ink-2",
        (s.state === "locked" || s.state === "skipped") && "border-dashed border-line-strong bg-surface text-ink-3",
        s.live && "border-signal bg-signal-wash text-signal-text",
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={s.live ? (s.paused ? "paused" : "live") : s.state === "done" ? "done" : "num"}
          className="grid place-items-center"
          initial={{ scale: 0.3, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.3, opacity: 0, transition: { duration: DURATION.fast } }}
          transition={SPRING}
        >
          {s.live ? (
            s.paused ? (
              <Pause size={10} weight="fill" />
            ) : (
              <span className="spinner !h-2.5 !w-2.5 !border-[1.5px]" />
            )
          ) : s.state === "done" ? (
            <Check size={11} weight="bold" />
          ) : (
            String(s.index + 1).padStart(2, "0")
          )}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {s.waiting && !s.live ? (
          <motion.span
            key="waiting"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={SPRING}
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warn"
          />
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/** The connector between two stages: idle dashes, a line that draws in when the earlier stage is done,
 *  and a pulse while the next stage is running. */
export function TraceSegment({
  lit,
  live,
  vertical,
  tone = "done",
}: {
  lit: boolean;
  live: boolean;
  vertical?: boolean;
  tone?: "done" | "signal";
}) {
  return (
    <span className={cx("relative block", vertical ? "w-[2px]" : "h-[2px]")} aria-hidden>
      <span className={cx("absolute inset-0", vertical ? "border-l-2" : "border-t-2", "border-dashed border-[var(--trace-idle)]")} />
      <motion.span
        className={cx(
          "absolute inset-0 rounded-full",
          vertical ? "origin-top" : "origin-left",
          live || tone === "signal" ? "bg-signal" : "bg-ink-3",
        )}
        initial={false}
        animate={vertical ? { scaleY: lit || live ? 1 : 0 } : { scaleX: lit || live ? 1 : 0 }}
        transition={{ duration: 0.55, ease: EASE_OUT }}
      />
      {live
        ? [0, 0.55].map((delay) => (
            <motion.span
              key={delay}
              className="absolute inset-0"
              initial={vertical ? { y: "-15%", opacity: 0 } : { x: "-15%", opacity: 0 }}
              animate={vertical ? { y: ["-15%", "100%"], opacity: [0, 1, 1, 0] } : { x: ["-15%", "100%"], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.1, ease: "linear", repeat: Infinity, delay }}
            >
              <span
                className={cx(
                  "absolute rounded-full bg-ink",
                  vertical ? "left-1/2 top-0 h-2 w-[4px] -translate-x-1/2" : "left-0 top-1/2 h-[4px] w-2 -translate-y-1/2",
                )}
              />
            </motion.span>
          ))
        : null}
    </span>
  );
}
