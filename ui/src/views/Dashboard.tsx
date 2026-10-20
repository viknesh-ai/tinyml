import { ArrowRight, Play } from "@phosphor-icons/react";
import { Link } from "wouter";
import { usePipelineActions } from "../actions";
import { Donut } from "../components/charts";
import { Button, PageHeader, StatCard, Status, cx } from "../components/ui";
import { ACTIVE, JOB_TITLES, NAV, useAction, usePanel, useWorkspace, viewPath } from "../data";
import { CONNECTIVITY, PRIORITY, num, pct, plural, relativeTime } from "../format";
import { useNavState } from "../shell/Sidebar";
import { PipelineBlocks } from "./PipelineBlocks";

/** The next thing to do: a running stage, a review that is waiting, or the first stage not done. */
function useNextStep() {
  const ws = useWorkspace();
  const state = useNavState();
  const actions = usePipelineActions();
  const live = NAV.find((n) => state[n.slug]?.live);
  if (live) return { slug: live.slug, text: `${live.title} is running. Its output streams in the console.`, action: null };
  const waiting = NAV.find((n) => state[n.slug]?.waiting);
  if (waiting) return { slug: waiting.slug, text: `${waiting.title} has results waiting for your review.`, action: null };
  const open = NAV.find((n) => n.step && !state[n.slug]?.done && !state[n.slug]?.locked && !(n.slug === "targets" && ws.data.dataset));
  if (!open) return null;
  const action = actions.find((a) => a.stage === open.step && !a.blocked) ?? null;
  return { slug: open.slug, text: `${open.title} is the next step.`, action };
}

export function Dashboard() {
  const ws = useWorkspace();
  const panel = usePanel();
  const next = useNextStep();
  const run = useAction();
  const d = ws.data;
  const spec = d.project.spec;
  const recipe = ws.recipes.find((r) => r.id === spec?.recipe);
  const st = d.dataset?.stats;
  const tr = d.training;
  const chosen = d.candidates.find((c) => c.selected);
  const build = d.builds[0];
  const classes = Object.entries(st?.class_seconds ?? {});
  const minutes = (st?.duration_s ?? 0) / 60;
  const trainShare = tr?.train_windows && tr.test_windows ? tr.train_windows / (tr.train_windows + tr.test_windows) : null;

  return (
    <div>
      <PageHeader
        title={d.project.name}
        lede={recipe ? `${recipe.title} · ${spec?.task === "anomaly" ? "anomaly detection" : "classification"}` : undefined}
        actions={
          next?.action ? (
            <Button variant="primary" icon={Play} busy={run.busy} onClick={() => run.run(next.action!.run)}>
              {next.action.title}
            </Button>
          ) : next ? (
            <Link href={viewPath(ws.pid, next.slug)} className="btn btn-primary">
              Open {NAV.find((n) => n.slug === next.slug)?.title}
              <ArrowRight size={14} weight="bold" className="nudge" />
            </Link>
          ) : undefined
        }
        stats={
          <div className="grid grid-cols-2 gap-3 @[960px]:grid-cols-4">
            <StatCard
              label="Data collected"
              value={d.dataset ? (minutes >= 1 ? `${num(minutes, 1)} min` : `${num(st?.duration_s)} s`) : "–"}
              sub={d.dataset ? `${num(st?.recordings)} recordings · ${classes.length} labels` : "No data yet"}
              figure={
                classes.length ? <Donut parts={classes.map(([name, value]) => ({ name, value }))} label="Data per label" /> : undefined
              }
            />
            <StatCard
              label="Train / test split"
              value={trainShare !== null ? `${pct(trainShare)} / ${pct(1 - trainShare)}` : "–"}
              sub={tr ? `${num(tr.windows)} windows` : "Set by training"}
              figure={
                trainShare !== null ? (
                  <Donut
                    parts={[
                      { name: "train", value: trainShare },
                      { name: "test", value: 1 - trainShare },
                    ]}
                    label="Train and test share"
                  />
                ) : undefined
              }
            />
            <StatCard
              label={spec?.task === "anomaly" ? "Faults caught" : "Recognised"}
              value={
                chosen?.metrics
                  ? spec?.task === "anomaly"
                    ? pct(chosen.metrics.detection_rate)
                    : pct(chosen.metrics.balanced_accuracy)
                  : "–"
              }
              sub={chosen ? (chosen.details?.title ?? chosen.algorithm) : "Not trained"}
            />
            <StatCard
              label="Package"
              value={build ? `v${build.version}` : "–"}
              sub={build ? `${build.passed ? "Verified" : "Blocked"} on ${ws.chip(build.chip_id)?.family ?? build.chip_id}` : "Not built"}
            />
          </div>
        }
      />

      <section aria-labelledby="pipeline-title" className="mb-6">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 id="pipeline-title" className="text-[15px] font-semibold">
            Pipeline
          </h2>
          <Link href={viewPath(ws.pid, "design")} className="text-[12.5px] font-medium text-signal-text hover:underline">
            Open pipeline design
          </Link>
        </div>
        <PipelineBlocks compact />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel min-w-0">
          <div className="flex items-center border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold">Recent runs</h2>
            <Link href={viewPath(ws.pid, "runs")} className="ml-auto text-[12.5px] font-medium text-signal-text hover:underline">
              View all
            </Link>
          </div>
          {d.jobs.length ? (
            <ul className="divide-y divide-line">
              {d.jobs.slice(0, 6).map((j) => {
                const live = ACTIVE.includes(j.status);
                return (
                  <li key={j.id}>
                    <Link
                      href={viewPath(ws.pid, "runs")}
                      onClick={() => panel.selectJob(j.id)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-2"
                    >
                      {live ? (
                        <span className="spinner !h-3 !w-3" />
                      ) : (
                        <span
                          className={cx(
                            "h-2 w-2 flex-none rounded-full",
                            j.status === "done" ? "bg-ok" : j.status === "failed" ? "bg-block" : "bg-ink-3",
                          )}
                        />
                      )}
                      <span className="font-medium">{JOB_TITLES[j.kind] ?? j.kind}</span>
                      <span className="min-w-0 grow truncate text-ink-3">{j.params?.chip_id ? ws.chipName(j.params.chip_id) : j.step}</span>
                      <span className="flex-none text-[12px] text-ink-3">{relativeTime(j.updated_at)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-5 text-[13px] text-ink-3">No runs yet.</p>
          )}
        </section>

        <section className="panel min-w-0">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Project info</h2>
          <dl className="spec-list px-4 py-1 text-[13px]">
            <dt>Use case</dt>
            <dd>{recipe?.title ?? "–"}</dd>
            {spec ? (
              <>
                <dt>Radio</dt>
                <dd>{CONNECTIVITY[spec.connectivity]}</dd>
                <dt>Priority</dt>
                <dd>{PRIORITY[spec.priority]}</dd>
              </>
            ) : null}
            <dt>Created</dt>
            <dd>{relativeTime(d.project.created_at)}</dd>
            <dt>ID</dt>
            <dd>{d.project.id}</dd>
          </dl>
          {d.reviews.some((r) => r.status !== "approved") ? (
            <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12.5px]">
              <Status tone="warn">{plural(d.reviews.filter((r) => r.status !== "approved").length, "review")} waiting</Status>
              <button type="button" className="text-signal-text hover:underline" onClick={() => panel.setOpen(true)}>
                Open the assistant
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
