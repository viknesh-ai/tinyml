import { ArrowClockwise, ArrowRight, UploadSimple } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { useLocation } from "wouter";
import { api, errorMessage } from "../api";
import { BarList, Donut, SignalChart, SpectrumChart, Sparkline } from "../components/charts";
import { toast } from "../components/Toast";
import { ActionBar, Button, Callout, Disclosure, LevelIcon, PageHeader, SectionTitle, Segmented, StatCard, cx } from "../components/ui";
import { backTo, useAction, useJobs, useWorkspace, stepPath } from "../data";
import type { Preview } from "../types";
import { num, plural } from "../format";
import { Reveal, SPRING } from "../motion";

const ROLE_NAMES: Record<string, string> = {
  time: "Time",
  sensor_axis: "Sensor reading",
  label: "Label (what happened)",
  recording_id: "Recording name",
  ignore: "Ignore",
};

const SEVERITY = {
  block: { level: "block", word: "Must fix" },
  warn: { level: "warn", word: "Worth checking" },
  fix: { level: "info", word: "Fixed automatically" },
} as const;

export function DataStep() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const jobs = useJobs();
  const next = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const ds = ws.data.dataset;

  const load = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await ws.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    load(`Reading and checking ${plural(files.length, "file")}…`, () => api(`/projects/${ws.pid}/datasets`, { body: fd }));
  };

  const blocked = !!ds?.issues.some((i) => i.severity === "block");
  const pending = ws.needsApproval("data");

  return (
    <div>
      <PageHeader title="Data" stats={ds ? <DataStats /> : undefined} />

      {ds ? null : <Upload busy={busy} over={over} setOver={setOver} upload={upload} hasData={false} />}
      <div className={cx(busy || error ? (ds ? "mb-4" : "mt-3") : "")} role="status">
        {busy ? (
          <span className="flex items-center gap-2 text-ink-2">
            <span className="spinner" /> {busy}
          </span>
        ) : error ? (
          <Callout level="block" title="The data could not be read">
            {error}
          </Callout>
        ) : null}
      </div>
      {ds ? <DatasetDetails upload={<Upload busy={busy} over={over} setOver={setOver} upload={upload} hasData />} /> : null}

      {ds ? (
        <ActionBar
          back={backTo(ws.pid, "data")}
          note={
            blocked ? (
              <span className="font-medium text-block">Fix the problems marked “Must fix” to continue.</span>
            ) : pending ? (
              "Review gates are on, so continuing approves this data."
            ) : (
              "Next: Training."
            )
          }
        >
          {!blocked ? (
            <Button
              variant="primary"
              size="lg"
              busy={next.busy}
              onClick={() =>
                next.run(async () => {
                  if (pending) await jobs.approve("data");
                  navigate(stepPath(ws.pid, "model"));
                })
              }
            >
              {pending ? "Approve and continue" : "Continue"}
              <ArrowRight size={15} weight="bold" className="nudge" />
            </Button>
          ) : null}
        </ActionBar>
      ) : null}
    </div>
  );
}

function Upload({
  busy,
  over,
  setOver,
  upload,
  hasData,
}: {
  busy: string | null;
  over: boolean;
  setOver: (o: boolean) => void;
  upload: (files: FileList | null) => void;
  hasData: boolean;
}) {
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        upload(e.dataTransfer.files);
      }}
      className={cx(
        "group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] px-6 text-center transition-colors duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink",
        hasData ? "py-5" : "py-14",
        over ? "bg-signal-wash" : "bg-surface hover:bg-surface-2",
      )}
    >
      <svg className="pointer-events-none absolute left-px top-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible" aria-hidden>
        <rect
          width="100%"
          height="100%"
          rx="9"
          fill="none"
          stroke={over ? "var(--ink)" : "var(--line-strong)"}
          strokeWidth="2"
          strokeDasharray="6 4"
          className={over ? "drop-ants" : undefined}
        />
      </svg>
      <motion.span
        animate={{ y: over ? -4 : 0, scale: over ? 1.08 : 1 }}
        transition={SPRING}
        className="relative text-ink-2 group-hover:text-ink"
      >
        <UploadSimple size={24} />
      </motion.span>
      <span className="relative font-semibold">{hasData ? "Replace the dataset" : "Drop CSV files or browse"}</span>
      <span className="relative text-[13px] text-ink-2">
        {hasData ? "Drop CSV files here or browse." : "One CSV per recording, or one file with a recording column."}
      </span>
      <input type="file" accept=".csv" multiple className="sr-only" disabled={!!busy} onChange={(e) => upload(e.target.files)} />
    </label>
  );
}

function DataStats() {
  const ws = useWorkspace();
  const ds = ws.data.dataset!;
  const st = ds.stats ?? {};
  const kinds = Object.entries(st.class_seconds ?? {});
  const minutes = (st.duration_s ?? 0) / 60;
  return (
    <div className="grid grid-cols-2 gap-3 @[960px]:grid-cols-4">
      <StatCard
        label="Data collected"
        value={minutes >= 1 ? `${num(minutes, 1)} min` : `${num(st.duration_s)} s`}
        sub={kinds.length > 1 ? "split by label" : "one label"}
        figure={kinds.length ? <Donut parts={kinds.map(([name, value]) => ({ name, value }))} label="Time per label" /> : undefined}
      />
      <StatCard label="Recordings" value={num(st.recordings)} sub={plural(ds.files.length, "file")} />
      <StatCard label="Sample rate" value={`${num(st.sample_rate_hz)} Hz`} sub={st.axes?.length ? `${st.axes.join(", ")}` : undefined} />
      <StatCard
        label="Labels"
        value={ds.label_map?.labels.length ? num(ds.label_map.labels.length) : "–"}
        sub={ds.label_map?.labels.length ? ds.label_map.labels.join(", ") : "No label column"}
      />
    </div>
  );
}

function DatasetDetails({ upload }: { upload: React.ReactNode }) {
  const ws = useWorkspace();
  const ds = ws.data.dataset!;
  const order = { block: 0, warn: 1, fix: 2 };
  const issues = [...ds.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const samples = ws.data.preview?.samples ?? [];
  const [picked, setPicked] = useState(0);
  const sample = samples[Math.min(picked, samples.length - 1)];

  return (
    <Reveal key={ds.id} className="space-y-6">
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @[880px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="panel min-w-0 self-start">
            <div className="flex items-baseline gap-3 border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold">Samples</h2>
              <span className="text-[12.5px] text-ink-3">two seconds of each label</span>
            </div>
            {samples.length ? (
              <div className="@container overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sample</th>
                      <th>Label</th>
                      <th className="num">Length</th>
                      <th className="hidden w-[96px] @[420px]:table-cell">
                        <span className="sr-only">Preview</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((sm, i) => {
                      const ser = Object.entries(sm.series).map(([name, values]) => ({ name, values }));
                      const on = i === picked;
                      return (
                        <tr
                          key={`${sm.label}-${sm.recording}`}
                          onClick={() => setPicked(i)}
                          aria-selected={on}
                          className={cx("cursor-pointer", on ? "bg-signal-wash" : "hover:bg-surface-2")}
                        >
                          <td>
                            <button
                              type="button"
                              className="text-left font-mono text-[12.5px]"
                              onClick={() => setPicked(i)}
                              aria-pressed={on}
                            >
                              {sm.label}.{sm.recording}
                            </button>
                          </td>
                          <td>{sm.label}</td>
                          <td className="num">{num((ser[0]?.values.length ?? 0) / sm.rate, 1)} s</td>
                          <td className="hidden @[420px]:table-cell">
                            <span className="block h-7 w-[88px]">
                              <Sparkline series={ser} label={`${sm.label}, ${sm.recording}`} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-5 text-[13px] text-ink-3">A preview appears after the files are read.</p>
            )}
            <LabelTime />
          </section>

          <div className="min-w-0 space-y-4">
            {sample ? <SignalPanel key={picked} sample={sample} /> : null}
            {upload}
            <section>
              <SectionTitle title="Checks" />
              {issues.length ? (
                <ul className="panel divide-y divide-line">
                  {issues.map((i, k) => {
                    const sv = SEVERITY[i.severity];
                    return (
                      <li key={k} className="flex gap-3 px-4 py-3">
                        <span className="mt-0.5">
                          <LevelIcon level={sv.level} />
                        </span>
                        <p className="text-ink-2">
                          <span className="font-medium text-ink">{sv.word}.</span> {i.message}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="panel flex items-center gap-2 px-4 py-3 text-[13px]">
                  <LevelIcon level="ok" /> No problems. Steady sample rate, no gaps, enough data for each label.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>

      <ColumnRoles />
    </Reveal>
  );
}

function ColumnRoles() {
  const ws = useWorkspace();
  const ds = ws.data.dataset!;
  const action = useAction();
  const [roles, setRoles] = useState<Record<string, string>>({ ...ds.roles });
  const labels = ds.label_map?.labels ?? [];
  const [normal, setNormal] = useState(ds.label_map?.normal_label ?? labels[0] ?? "");
  const unsure = new Set(ws.data.pending_decisions.filter((p) => p.decision_type === "column_role").map((p) => p.decision_key));
  const dirty = JSON.stringify(roles) !== JSON.stringify(ds.roles) || normal !== (ds.label_map?.normal_label ?? labels[0] ?? "");

  return (
    <Disclosure
      title={`Columns (${ds.summary.columns.length})${unsure.size ? " · check the highlighted rows" : ""}`}
      defaultOpen={unsure.size > 0}
    >
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Is</th>
                <th>Type</th>
                <th className="num">Lowest</th>
                <th className="num">Highest</th>
                <th>Sample values</th>
              </tr>
            </thead>
            <tbody>
              {ds.summary.columns.map((c) => (
                <tr key={c.name} className={cx(unsure.has(c.name.toLowerCase()) && "bg-warn-wash")}>
                  <td className="font-medium">{c.name}</td>
                  <td>
                    <select
                      className="field-input !min-h-8 !w-auto !py-1 text-[13px]"
                      aria-label={`What column ${c.name} is`}
                      value={roles[c.name]}
                      onChange={(e) => setRoles({ ...roles, [c.name]: e.target.value })}
                    >
                      {Object.entries(ROLE_NAMES).map(([r, label]) => (
                        <option key={r} value={r}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-ink-3">{c.dtype}</td>
                  <td className="num">{c.min != null ? num(c.min, 3) : "–"}</td>
                  <td className="num">{c.max != null ? num(c.max, 3) : "–"}</td>
                  <td className="max-w-[220px] truncate font-mono text-[12px] text-ink-3">{c.sample.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3">
          {ws.data.project.spec?.task === "anomaly" && labels.length ? (
            <label className="block min-w-[220px]">
              <span className="mb-1 block text-[13px] font-medium">Which label means normal operation?</span>
              <select className="field-input" value={normal} onChange={(e) => setNormal(e.target.value)}>
                {labels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            className="ml-auto"
            icon={ArrowClockwise}
            disabled={!dirty}
            busy={action.busy}
            onClick={() =>
              action.run(async () => {
                await api(`/projects/${ws.pid}/datasets/roles`, { method: "PUT", json: { roles, normal_label: normal || null } });
                toast("Re-checked with your choices");
                await ws.refresh();
              })
            }
          >
            Apply and re-check
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}

/** One sample over time, or how strong each frequency is in it. The shaded span is one window of the model. */
function SignalPanel({ sample }: { sample: Preview["samples"][number] }) {
  const ws = useWorkspace();
  const [view, setView] = useState<"time" | "frequency">("time");
  const series = Object.entries(sample.series).map(([name, values]) => ({ name, values }));
  const tr = ws.data.training;
  const recipe = ws.recipes.find((r) => r.id === ws.data.project.spec?.recipe);
  const rate = tr?.sample_rate_hz ?? ws.data.dataset?.stats?.sample_rate_hz;
  const windowS = tr?.window_samples && rate ? tr.window_samples / rate : recipe?.window_ms ? recipe.window_ms / 1000 : undefined;
  const name = `${sample.label}.${sample.recording}`;
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      className="panel overflow-hidden px-4 pb-4 pt-3"
      aria-label="Signal"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 grow">
          <div className="text-[12px] font-medium text-ink-3">Signal</div>
          <h2 className="truncate font-mono text-[14px] font-medium">{name}</h2>
        </div>
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            ["time", "Time"],
            ["frequency", "Frequency"],
          ]}
        />
      </div>
      {view === "time" ? (
        <SignalChart series={series} rate={sample.rate} window={windowS} label={`Signal of ${name}`} />
      ) : (
        <SpectrumChart series={series} rate={sample.rate} label={`Frequency content of ${name}`} />
      )}
    </motion.section>
  );
}

/** Recorded time per label on one scale, so a label with too little data stands out. */
function LabelTime() {
  const ds = useWorkspace().data.dataset!;
  const secs = Object.entries(ds.stats?.class_seconds ?? {}).sort((a, b) => b[1] - a[1]);
  if (secs.length < 2) return null;
  const recs = ds.stats?.class_recordings ?? {};
  const time = (s: number) => (s >= 90 ? `${num(s / 60, 1)} min` : `${num(s)} s`);
  return (
    <div className="border-t border-line px-2 py-3">
      <h3 className="mb-1 px-2 text-[13px] font-semibold">Time per label</h3>
      <BarList
        label="Recorded time per label"
        items={secs.map(([label, s]) => ({
          key: label,
          label: <span className="font-mono">{label}</span>,
          sub: recs[label] != null ? plural(recs[label], "recording") : undefined,
          value: s,
          text: <span className="font-mono">{time(s)}</span>,
        }))}
      />
    </div>
  );
}
