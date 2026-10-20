import { Check, Pause, Play, Stop, TerminalWindow } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { useJobControl } from "../actions";
import { Button, Callout, Confirm } from "../components/ui";
import { DURATION, EASE_OUT } from "../motion";
import { ACTIVE, useAction, useJobs, usePanel, useWorkspace } from "../data";
import type { Job, Stage } from "../types";

export function useRunning(kinds: Job["kind"][]) {
  const job = useWorkspace().data.active_job;
  return job && ACTIVE.includes(job.status) && kinds.includes(job.kind) ? job : null;
}

/** Shown on a step whose next job waits for the person to approve an earlier stage. */
export function GateNotice({ stage, verb }: { stage: Stage; verb: string }) {
  const ws = useWorkspace();
  const jobs = useJobs();
  const panel = usePanel();
  const action = useAction();
  if (!ws.needsApproval(stage)) return null;
  const card = ws.review(stage)!;
  return (
    <div className="mb-5">
      <Callout
        level="warn"
        title={`${card.title} is waiting for your review`}
        action={
          <>
            <Button size="sm" variant="primary" icon={Check} busy={action.busy} onClick={() => action.run(() => jobs.approve(stage))}>
              Approve {card.title.toLowerCase()}
            </Button>
            <Button size="sm" onClick={() => panel.showReview(stage)}>
              Read the review card
            </Button>
          </>
        }
      >
        Review gates are on, so {verb} waits until you approve it.
      </Callout>
    </div>
  );
}

/** The live run of this step, with its controls, so nobody has to look for them elsewhere. */
export function RunningBanner({ job, text }: { job: Job; text: string }) {
  const panel = usePanel();
  const control = useJobControl();
  const action = useAction();
  const [confirmStop, setConfirmStop] = useState(false);
  const paused = job.status === "paused";
  const stopping = job.status === "cancelling";
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className="mb-5 overflow-hidden rounded-[10px] border border-signal/50 bg-signal-wash"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {paused ? <Pause size={16} weight="fill" className="text-warn" /> : <span className="spinner" />}
        <div className="min-w-0 grow basis-[220px]">
          <div className="font-medium">
            {paused ? "Paused" : job.status === "pausing" ? "Pausing after the current step" : stopping ? "Stopping…" : text}
          </div>
          <div className="truncate text-[13px] text-ink-2">{job.step || "Starting…"}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {job.status === "queued" || job.status === "running" ? (
            <Button size="sm" icon={Pause} busy={action.busy} onClick={() => action.run(() => control(job.id, "pause"))}>
              Pause
            </Button>
          ) : null}
          {paused || job.status === "pausing" ? (
            <Button size="sm" icon={Play} busy={action.busy} onClick={() => action.run(() => control(job.id, "resume"))}>
              Resume
            </Button>
          ) : null}
          {!stopping ? (
            <Button size="sm" icon={Stop} className="!text-block" onClick={() => setConfirmStop(true)}>
              Stop
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={TerminalWindow} onClick={() => panel.showJob(job.id)}>
            Output
          </Button>
        </div>
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
    </motion.div>
  );
}
