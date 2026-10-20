import { useLocation } from "wouter";
import { api } from "./api";
import { toast } from "./components/Toast";
import { ACTIVE, stepPath, useJobs, useWorkspace, type StepKey } from "./data";

export interface PipelineAction {
  id: string;
  stage: StepKey;
  title: string;
  /** Why the action cannot run right now, in words a person can act on. Null when it can run. */
  blocked: string | null;
  run: () => Promise<void>;
}

/**
 * The runnable stages with the same rules the stage pages apply, so the command palette and the workflow
 * inspector never start a job the page itself would refuse.
 */
export function usePipelineActions(): PipelineAction[] {
  const ws = useWorkspace();
  const jobs = useJobs();
  const [, navigate] = useLocation();
  const d = ws.data;
  const busy = d.active_job && ACTIVE.includes(d.active_job.status) ? "Another run is in progress" : null;
  const selected = d.candidates.find((c) => c.selected);
  const top = d.chip_results.filter((r) => r.rank).sort((a, b) => a.rank! - b.rank!)[0];
  const buildChip = d.builds[0]?.chip_id ?? top?.chip_id ?? ws.singleChip;

  const train: PipelineAction = {
    id: "train",
    stage: "model",
    title: d.candidates.length ? "Train again" : "Train models",
    blocked: !d.dataset ? "Add a dataset in the Data Lab first" : ws.needsApproval("data") ? "Approve the data checks first" : busy,
    run: () => jobs.start("train"),
  };

  const rank: PipelineAction = {
    id: "rank",
    stage: "rank",
    title: d.chip_results.length ? "Benchmark again" : "Benchmark the target chips",
    blocked: ws.singleChip
      ? "Only one chip is shortlisted, so there is nothing to compare"
      : !selected
        ? "Train and choose a model first"
        : ws.needsApproval("model")
          ? "Approve the model first"
          : busy,
    run: () => jobs.start("rank"),
  };

  const build: PipelineAction = {
    id: "build",
    stage: "build",
    title: buildChip ? `Build for ${ws.chip(buildChip)?.family ?? buildChip}` : "Build the package",
    blocked: !selected
      ? "Train and choose a model first"
      : !buildChip
        ? "Run the benchmark to pick a chip first"
        : ws.needsApproval("model")
          ? "Approve the model first"
          : busy,
    run: async () => {
      if (!buildChip) return;
      if (ws.needsApproval("rank")) {
        await api(`/projects/${ws.pid}/reviews`, {
          json: { stage: "rank", status: "approved", note: `Chose ${ws.chipName(buildChip)}` },
        });
      }
      await jobs.start("build", { chip_id: buildChip });
      navigate(stepPath(ws.pid, "build"));
    },
  };

  return [train, rank, build];
}

/** Pause, resume and stop for the running job, shared by the title bar, console, Runs view and palette. */
export function useJobControl() {
  const ws = useWorkspace();
  return async (jobId: string, verb: "pause" | "resume" | "cancel") => {
    await api(`/jobs/${jobId}/${verb}`, { json: {} });
    toast({ pause: "Pausing after the current step", resume: "Resumed", cancel: "Stopping after the current step" }[verb]);
    await ws.refresh();
  };
}
