import { ArrowClockwise, ArrowLeft, ArrowRight, Flask, Play } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { BarList, Confusion, Histogram, classScores } from "../components/charts";
import { ActionBar, Button, Callout, Confirm, Empty, Meter, PageHeader, StatCard, Prov, Status, cx } from "../components/ui";
import { backTo, useAction, useJobs, useWorkspace, stepPath } from "../data";
import { bytes, cap, num, pct } from "../format";
import type { Candidate, Training } from "../types";
import { Reveal } from "../motion";
import { GateNotice, RunningBanner, useRunning } from "./shared";

const KIND: Record<number, string> = { 1: "Rules", 2: "Classic ML", 3: "Neural network (earlier run)" };

const TITLES: Record<string, string> = {
  threshold_rule: "Simple limits",
  decision_tree: "Decision rules",
  random_forest: "Random forest",
  gradient_boosting: "Boosted trees (XGBoost)",
  isolation_forest: "Isolation forest",
  quantized_mlp: "Small neural network",
};

const title = (c: Candidate) => c.details?.title ?? TITLES[c.algorithm] ?? c.algorithm;

type Task = "anomaly" | "classification";

function resultLine(c: Candidate, task: Task) {
  const m = c.metrics ?? {};
  if (task === "anomaly")
    return `Catches ${m.detection_rate == null ? "n/a" : pct(m.detection_rate)} of faults, ${pct(m.false_alarm_rate, 1)} false alarms`;
  return `Recognises ${pct(m.balanced_accuracy)} of each event on average`;
}

function headline(c: Candidate, task: Task) {
  const m = c.metrics ?? {};
  return task === "anomaly" ? m.detection_rate : m.balanced_accuracy;
}

function Rules({ text }: { text: string }) {
  const rules = text.match(/^(Rules were enough|Rules, below the target): (if .*)\.$/);
  if (!rules || !rules[2].includes("; ")) return <p className="text-ink-2">{text}</p>;
  return (
    <div>
      <p className="text-ink-2">The device follows these rules:</p>
      <ol className="mt-2 space-y-1.5">
        {rules[2].split("; ").map((r, i) => (
          <li key={i} className="flex gap-2.5 rounded-[6px] bg-surface-2 px-3 py-2 font-mono text-[12.5px]">
            <span className="text-ink-3">{i + 1}</span>
            {r}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ModelStep() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const jobs = useJobs();
  const train = useAction();
  const next = useAction();
  const [confirm, setConfirm] = useState<Candidate | null>(null);
  const [tab, setTab] = useState<"results" | "methods" | "testing">("results");
  const d = ws.data;
  const tr = d.training;
  const task = d.project.spec!.task;
  const recipe = ws.recipes.find((r) => r.id === d.project.spec!.recipe);
  const chosen = d.candidates.find((c) => c.selected);
  const running = useRunning(["train", "select"]);
  const gated = ws.needsApproval("data");

  const use = (c: Candidate) => {
    if (!c.passed) return setConfirm(c);
    return train.run(() => jobs.start("select", { candidate_id: c.id }));
  };

  const trainButton = (
    <Button
      variant={d.candidates.length ? "default" : "primary"}
      icon={d.candidates.length ? ArrowClockwise : Play}
      disabled={!!running || gated}
      busy={train.busy}
      onClick={() => train.run(() => jobs.start("train"))}
    >
      {d.candidates.length ? "Train again" : "Find the model"}
    </Button>
  );

  const best = tr ? d.candidates.find((c) => c.id === tr.best) : undefined;
  const goal = task === "anomaly" ? recipe?.targets.anomaly.detection_rate : recipe?.targets.classification.accuracy;

  return (
    <div>
      <PageHeader
        title="Training"
        lede="Methods are tried from simplest to most complex and tested on recordings held back from training."
        actions={d.candidates.length ? trainButton : undefined}
        tabs={
          tr
            ? [
                { label: "Results", current: tab === "results", onSelect: () => setTab("results") },
                { label: "Methods", count: d.candidates.length, current: tab === "methods", onSelect: () => setTab("methods") },
                { label: "How it was tested", current: tab === "testing", onSelect: () => setTab("testing") },
              ]
            : undefined
        }
        stats={
          chosen && tr ? (
            <div className="grid grid-cols-2 gap-3 @[960px]:grid-cols-4">
              <StatCard label="Chosen model" value={chosen.details?.title ?? chosen.algorithm} sub={chosen.details?.setting} />
              <StatCard
                label={task === "anomaly" ? "Faults caught" : "Recognised"}
                value={pct(task === "anomaly" ? chosen.metrics?.detection_rate : chosen.metrics?.balanced_accuracy)}
                sub={
                  recipe
                    ? task === "anomaly"
                      ? `target ${pct(recipe.targets.anomaly.detection_rate)} · false alarms ${pct(chosen.metrics?.false_alarm_rate, 1)}`
                      : `target ${pct(recipe.targets.classification.accuracy)}`
                    : undefined
                }
              />
              <StatCard
                label="Model size"
                value={
                  <>
                    {bytes(chosen.metrics?.size_bytes)}
                    <Prov tag="estimated" />
                  </>
                }
                sub={`tested on ${num(tr.test_windows)} windows`}
              />
              <StatCard
                label="Methods tried"
                value={num(d.candidates.length)}
                sub={tr.settings_tried ? `${num(tr.settings_tried)} settings tuned` : undefined}
              />
            </div>
          ) : undefined
        }
      />
      <GateNotice stage="data" verb="training" />
      {running ? (
        <RunningBanner job={running} text={running.kind === "train" ? "Training and testing every method…" : "Switching the model…"} />
      ) : null}

      {!tr ? (
        running ? null : (
          <Empty icon={Flask} title="No model yet" action={trainButton}>
            Takes about a minute. You can pause it from the top bar.
          </Empty>
        )
      ) : (
        <div className="space-y-8">
          {!chosen && tr.data_request ? (
            <Callout
              level="warn"
              title="No model met the target"
              action={
                <>
                  {best ? (
                    <Button size="sm" variant="primary" onClick={() => use(best)}>
                      Use the strongest ({title(best)})
                    </Button>
                  ) : null}
                  <Link href={stepPath(ws.pid, "data")} className="btn btn-sm">
                    <ArrowLeft size={14} /> Back to the data
                  </Link>
                </>
              }
            >
              {tr.data_request} Improve the data and train again, or use the strongest model anyway; the report will say it is below the
              target.
            </Callout>
          ) : null}

          {tab === "results" ? (
            <>
              {chosen ? (
                <Reveal key={chosen.id}>
                  <ChosenModel c={chosen} tr={tr} />
                </Reveal>
              ) : null}
              <Reveal order={1}>
                <Results tr={tr} c={chosen ?? best} task={task} />
              </Reveal>
            </>
          ) : tab === "methods" ? (
            <Reveal>
              <Methods tr={tr} task={task} goal={goal} running={!!running} onUse={use} />
            </Reveal>
          ) : (
            <Reveal>
              <TestingDetails tr={tr} task={task} candidates={d.candidates} />
            </Reveal>
          )}
        </div>
      )}

      {chosen ? (
        <ActionBar
          back={backTo(ws.pid, "model")}
          note={ws.singleChip ? `Next: the final build for ${ws.chipName(ws.singleChip)}.` : "Next: Benchmark."}
        >
          <Button
            variant="primary"
            size="lg"
            busy={next.busy}
            disabled={!!running}
            onClick={() =>
              next.run(async () => {
                if (ws.needsApproval("model")) await jobs.approve("model");
                navigate(stepPath(ws.pid, ws.singleChip ? "build" : "rank"));
              })
            }
          >
            {ws.needsApproval("model") ? "Approve and continue" : ws.singleChip ? "Continue to Deploy" : "Continue to Benchmark"}
            <ArrowRight size={15} weight="bold" className="nudge" />
          </Button>
        </ActionBar>
      ) : null}

      <Confirm
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Use a model below the target?"
        body={
          confirm ? (
            <>
              {title(confirm)}: {resultLine(confirm, task).toLowerCase()}. You can still build it, and the package report will say it is
              below the target.
            </>
          ) : null
        }
        confirmLabel="Use it anyway"
        onConfirm={() => (confirm ? jobs.start("select", { candidate_id: confirm.id }) : undefined)}
      />
    </div>
  );
}

function ChosenModel({ c, tr }: { c: Candidate; tr: Training }) {
  const det = c.details ?? {};
  return (
    <section className="panel overflow-hidden" aria-labelledby="chosen-title">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 px-5 py-2.5 text-[13px]">
        <span className="font-medium">{c.id === tr.recommended ? "Recommended and in use" : "In use"}</span>
        <span className="ml-auto flex gap-1.5">
          <Status>{KIND[c.rung] ?? "Other"}</Status>
          <Status tone={c.passed ? "ok" : "warn"}>{c.passed ? "Meets the target" : "Below the target"}</Status>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-5 py-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 id="chosen-title" className="text-[20px] font-semibold">
            {title(c)}
          </h2>
          <p className="mt-0.5 font-mono text-[12.5px] text-ink-3">{det.setting || c.note}</p>
          {det.what ? <p className="mt-3">{det.what}</p> : null}
          <h3 className="mb-1.5 mt-5 text-[13.5px] font-semibold">How it decides</h3>
          <Rules text={det.explanation || tr.explanation} />
          {det.why ? (
            <p className="mt-4 border-l-2 border-signal pl-3 text-[13.5px] text-ink-2">
              <span className="font-medium text-ink">Why this one: </span>
              {det.why}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <dl className="spec-list text-[13px]">
            {det.cost ? (
              <>
                <dt>Work per answer</dt>
                <dd>{det.cost.trees && det.cost.trees > 1 ? `${det.cost.trees} trees` : `${det.cost.comparisons ?? 0} comparisons`}</dd>
              </>
            ) : null}
            {det.features ? (
              <>
                <dt>Frequency analysis</dt>
                <dd>{det.needs_fft ? "Yes (FFT)" : "Not needed"}</dd>
              </>
            ) : null}
          </dl>
          {det.features?.length ? (
            <div className="mt-4">
              <div className="mb-1.5 text-[12.5px] text-ink-3">Measurements it looks at ({det.features.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {det.features.map((f) => (
                  <span key={f} className="rounded-[4px] border border-line px-2 py-0.5 text-[12px] text-ink-2">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TestingDetails({ tr, task, candidates }: { tr: Training; task: Task; candidates: Candidate[] }) {
  const score = (v: number | null | undefined) => (v == null ? "–" : task === "anomaly" ? num(v, 3) : pct(v, 1));
  return (
    <section className="panel px-5 py-4">
      <h2 className="mb-2 text-[15px] font-semibold">How it was tested</h2>
      <div className="max-w-[80ch] space-y-3 text-[13.5px] text-ink-2">
        <p>
          Split: {tr.split}. {num(tr.train_windows)} training windows and {num(tr.test_windows)} test windows
          {tr.validation_fault_windows
            ? `, plus ${num(tr.validation_fault_windows)} fault windows kept apart for choosing settings (never used for the test).`
            : "."}
        </p>
        <p>
          Settings were chosen by {tr.fold_method || "cross-validation"}. {num(tr.settings_tried)} settings were tried in total, and for
          each method the simplest setting within one standard error of the best was kept.
        </p>
      </div>
      {candidates
        .filter((c) => c.details?.settings?.length)
        .map((c) => {
          const det = c.details!;
          return (
            <div key={c.id} className="mt-5">
              <h3 className="text-[13.5px] font-semibold">
                {det.title}
                {det.settings_tried && det.settings_tried > det.settings!.length ? (
                  <span className="font-normal text-ink-3">
                    {" "}
                    · best {det.settings!.length} of {num(det.settings_tried)} shown
                  </span>
                ) : null}
              </h3>
              <div className="mt-2 overflow-x-auto rounded-[8px] border border-line">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th className="num">Cross-validation score</th>
                      {task === "anomaly" ? (
                        <>
                          <th className="num">Faults caught</th>
                          <th className="num">False alarms</th>
                        </>
                      ) : null}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {det.settings!.map((s) => (
                      <tr key={s.label} className={cx(s.chosen && "bg-signal-wash/60")}>
                        <td>{s.label}</td>
                        <td className="num">
                          {score(s.cv)}
                          {s.cv_std ? <span className="text-ink-3"> ±{score(s.cv_std)}</span> : null}
                        </td>
                        {task === "anomaly" ? (
                          <>
                            <td className="num">{s.detection_rate == null ? "–" : pct(s.detection_rate)}</td>
                            <td className="num">{pct(s.false_alarm_rate, 1)}</td>
                          </>
                        ) : null}
                        <td>{s.chosen ? <Status tone="signal">Kept</Status> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </section>
  );
}

function Results({ tr, c, task }: { tr: Training; c: Candidate | undefined; task: Task }) {
  const viz = tr.viz ?? {};
  const hasHist = !!(viz.hist && Object.keys(viz.hist).length && viz.bins?.length);
  const matrix = c?.metrics?.confusion;
  const m = c?.metrics ?? {};
  const scores = matrix ? classScores(matrix) : null;
  const rows: [string, string][] =
    task === "anomaly"
      ? [
          ["Faults caught", m.detection_rate == null ? "–" : pct(m.detection_rate, 1)],
          ["False alarms", pct(m.false_alarm_rate, 1)],
          ["Normal test windows", num(m.test_normal_windows)],
          ["Fault test windows", num(m.test_fault_windows)],
        ]
      : [
          ["Accuracy", pct(m.accuracy ?? scores?.accuracy, 1)],
          ["Balanced accuracy", pct(m.balanced_accuracy, 1)],
          ["Average precision", pct(scores?.precision, 1)],
          ["Average recall", pct(scores?.recall, 1)],
          ["Average F1 score", scores?.f1 == null ? "–" : num(scores.f1, 2)],
          ["Test windows", num(m.test_windows ?? tr.test_windows)],
        ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {matrix ? (
          <section className="panel min-w-0 px-5 py-4" aria-labelledby="cm-title">
            <h2 id="cm-title" className="text-[15px] font-semibold">
              Confusion matrix <span className="font-normal text-ink-3">· test set</span>
            </h2>
            <p className="mb-3 text-[13px] text-ink-2">Rows are what happened, columns what the model answered.</p>
            <Confusion matrix={matrix} classes={tr.classes} />
          </section>
        ) : null}
        <section className="panel min-w-0 overflow-hidden" aria-labelledby="metrics-title">
          <h2 id="metrics-title" className="border-b border-line px-5 py-3 text-[15px] font-semibold">
            Metrics <span className="font-normal text-ink-3">· test set</span>
          </h2>
          <table className="data-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="text-ink-2">{k}</td>
                  <td className="num font-medium">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {hasHist ? (
        <section className="panel px-5 py-4" aria-labelledby="hist-title">
          <h2 id="hist-title" className="text-[15px] font-semibold">
            Most useful measurement
          </h2>
          <p className="mb-3 text-[13px] text-ink-2">{cap(viz.feature_label)}, for each kind of data.</p>
          <Histogram
            bins={viz.bins!}
            hist={viz.hist!}
            thresholds={viz.thresholds}
            xTitle={cap(viz.feature_label)}
            label={`Distribution of ${viz.feature_label}`}
          />
        </section>
      ) : null}
    </div>
  );
}

/** Every method on one scale against the target, then the full table, so the trade-off reads at a glance. */
function Methods({
  tr,
  task,
  goal,
  running,
  onUse,
}: {
  tr: Training;
  task: Task;
  goal: number | undefined;
  running: boolean;
  onUse: (c: Candidate) => void;
}) {
  const ws = useWorkspace();
  const all = ws.data.candidates;
  const trained = all.filter((c) => c.artifact_path);
  return (
    <div className="space-y-4">
      {trained.length ? (
        <section className="panel px-4 py-4" aria-labelledby="methods-chart">
          <h2 id="methods-chart" className="mb-1 px-2 text-[15px] font-semibold">
            {task === "anomaly" ? "Faults caught on unseen recordings" : "Recognised on unseen recordings"}
          </h2>
          <BarList
            label="Result of each method"
            max={1}
            goal={goal != null ? { value: goal, label: `Target ${pct(goal)}` } : undefined}
            items={trained.map((c) => {
              const v = headline(c, task) ?? null;
              return {
                key: c.id,
                label: title(c),
                sub: [c.metrics?.size_bytes ? bytes(c.metrics.size_bytes) : null, KIND[c.rung]].filter(Boolean).join(" · "),
                value: v,
                tone: c.passed ? "ok" : "warn",
                current: !!c.selected,
                text: <span className="font-mono">{v == null ? "n/a" : pct(v)}</span>,
              };
            })}
          />
        </section>
      ) : null}
      <section className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Result on unseen recordings</th>
              <th className="num">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {all.map((c) => {
              const det = c.details ?? {};
              const value = headline(c, task);
              return (
                <tr key={c.id} className={cx(!!c.selected && "bg-signal-wash/50")}>
                  <td className="min-w-[220px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{title(c)}</span>
                      <Status>{KIND[c.rung] ?? "Other"}</Status>
                      {c.id === tr.recommended ? <Status tone="signal">Recommended</Status> : null}
                    </div>
                    <p className="mt-1 text-[12.5px] text-ink-2">{det.why || det.what || c.note}</p>
                  </td>
                  <td className="min-w-[200px]">
                    {c.artifact_path ? (
                      <>
                        <Status tone={c.passed ? "ok" : "warn"}>{c.passed ? "Meets target" : "Below target"}</Status>
                        <p className="mt-1 text-[12.5px]">{resultLine(c, task)}</p>
                        {value != null && goal != null ? (
                          <div className="mt-2 max-w-[220px]">
                            <Meter value={value} goal={goal} passed={!!c.passed} />
                          </div>
                        ) : null}
                        <p className="mt-1 text-[12px] text-ink-3">{det.setting || c.note}</p>
                      </>
                    ) : (
                      <span className="text-ink-3">Not trained</span>
                    )}
                  </td>
                  <td className="num">{c.metrics?.size_bytes ? bytes(c.metrics.size_bytes) : "–"}</td>
                  <td className="text-right">
                    {c.selected ? (
                      <Status tone="signal">In use</Status>
                    ) : c.artifact_path ? (
                      <Button size="sm" disabled={running} onClick={() => onUse(c)}>
                        Use this
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
