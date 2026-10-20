import { ArrowRight, Flask, Lightning, SealCheck, Waveform } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { cx } from "../components/ui";
import { ACTIVE, useWorkspace, viewPath, type ViewSlug } from "../data";
import { num, pct } from "../format";
import { EASE_OUT, SPRING } from "../motion";

interface Block {
  id: "input" | "features" | "model" | "output";
  title: string;
  kind: string;
  color: string;
  icon: ComponentType<{ size?: number; weight?: "fill" | "regular" | "bold" }>;
  rows: [string, ReactNode][];
  empty?: string;
  edit: { label: string; view: ViewSlug };
}

/** The four blocks of the pipeline, read from the dataset, the recipe and the chosen model. */
export function usePipelineBlocks(): Block[] {
  const ws = useWorkspace();
  const d = ws.data;
  const spec = d.project.spec;
  const recipe = ws.recipes.find((r) => r.id === spec?.recipe);
  const tr = d.training;
  const st = d.dataset?.stats;
  const rate = tr?.sample_rate_hz ?? st?.sample_rate_hz;
  const windowMs = tr?.window_samples && rate ? (tr.window_samples / rate) * 1000 : recipe?.window_ms;
  const stepMs =
    tr?.hop && rate ? (tr.hop / rate) * 1000 : recipe?.window_ms && recipe.hop_ratio ? recipe.window_ms * recipe.hop_ratio : undefined;
  const chosen = d.candidates.find((c) => c.selected);
  const axes = st?.axes ?? [];
  const classes = spec?.task === "anomaly" ? ["normal", "anomaly score"] : (tr?.classes ?? d.dataset?.label_map?.labels ?? []);
  const metric = chosen?.metrics
    ? spec?.task === "anomaly"
      ? `${pct(chosen.metrics.detection_rate)} of faults caught`
      : `${pct(chosen.metrics.balanced_accuracy)} recognised`
    : null;

  return [
    {
      id: "input",
      title: "Time-series input",
      kind: recipe?.sensor ? `${recipe.sensor} recordings` : "Sensor recordings",
      color: "var(--series-1)",
      icon: Waveform,
      rows: [
        [`Axes${axes.length ? ` (${axes.length})` : ""}`, axes.length ? axes.join(", ") : "–"],
        ["Window size", windowMs ? `${num(windowMs)} ms` : "–"],
        ["Window step", stepMs ? `${num(stepMs)} ms` : "–"],
        ["Frequency", rate ? `${num(rate)} Hz` : "–"],
      ],
      empty: d.dataset ? undefined : "Add recordings in Data",
      edit: { label: "Open Data", view: "dataset" },
    },
    {
      id: "features",
      title: "Feature extraction",
      kind: recipe?.feature_families?.length
        ? recipe.feature_families.map((f) => (f === "time" ? "Time domain" : "Spectral")).join(" + ")
        : "Measurements",
      color: "var(--series-3)",
      icon: Lightning,
      rows: [
        ["Used by the model", chosen?.details?.features?.length ? `${chosen.details.features.length} measurements` : "–"],
        ["Frequency analysis", chosen?.details ? (chosen.details.needs_fft ? "Yes (FFT)" : "No") : "–"],
        ["Windows", tr ? `${num(tr.train_windows)} train · ${num(tr.test_windows)} test` : "–"],
      ],
      empty: tr ? undefined : "Calculated when training runs",
      edit: { label: "Open Training", view: "training" },
    },
    {
      id: "model",
      title: chosen?.details?.title ?? "Model",
      kind: chosen ? "Chosen model" : "Not chosen yet",
      color: "var(--series-4)",
      icon: Flask,
      rows: [
        ["Setting", chosen?.details?.setting ?? "–"],
        ["Result on unseen recordings", metric ?? "–"],
        ["Methods tried", d.candidates.length ? num(d.candidates.length) : "–"],
      ],
      empty: chosen ? undefined : "Train in Training",
      edit: { label: "Open Training", view: "training" },
    },
    {
      id: "output",
      title: "Output",
      kind: spec?.task === "anomaly" ? "Anomaly detection" : "Classification",
      color: "var(--series-2)",
      icon: SealCheck,
      rows: [[`Outputs${classes.length ? ` (${classes.length})` : ""}`, classes.length ? classes.join(", ") : "–"]],
      edit: { label: "Open Deployment", view: "deploy" },
    },
  ];
}

/** The pipeline as connected blocks. While training runs, a pulse travels along the connectors. */
export function PipelineBlocks({ compact }: { compact?: boolean }) {
  const ws = useWorkspace();
  const blocks = usePipelineBlocks();
  const calm = useReducedMotion();
  const job = ws.data.active_job;
  const live = !!job && ACTIVE.includes(job.status) && job.status !== "paused" && (job.kind === "train" || job.kind === "select");

  return (
    <div className="@container">
      <ol className="grid grid-cols-1 gap-4 @[640px]:grid-cols-2 @[1000px]:grid-cols-4 @[1000px]:gap-8">
        {blocks.map((b, i) => {
          const Icon = b.icon;
          return (
            <li key={b.id} className="relative min-w-0">
              <motion.article
                initial={calm ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: i * 0.07 }}
                className={cx(
                  "panel relative flex h-full flex-col overflow-hidden",
                  live && b.id !== "output" && b.id !== "input" && "shadow-[var(--glow)]",
                )}
              >
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: b.color }} aria-hidden />
                <div className="flex items-start gap-3 px-4 pb-2 pt-4">
                  <div className="min-w-0 grow">
                    <div className="text-[11.5px] font-medium text-ink-3">{b.kind}</div>
                    <h3 className="truncate text-[14.5px] font-semibold">{b.title}</h3>
                  </div>
                  <span
                    className="grid h-9 w-9 flex-none place-items-center rounded-full text-white"
                    style={{ background: b.color }}
                    aria-hidden
                  >
                    <Icon size={17} weight="fill" />
                  </span>
                </div>
                {b.empty ? (
                  <p className="px-4 pb-4 text-[13px] text-ink-3">{b.empty}</p>
                ) : (
                  <dl className={cx("m-0 grow px-4", compact ? "pb-3" : "pb-2")}>
                    {(compact ? b.rows.slice(0, 2) : b.rows).map(([k, v]) => (
                      <div key={k} className="border-t border-dashed border-line py-2 first:border-t-0">
                        <dt className="text-[12px] text-ink-3">{k}</dt>
                        <dd className="m-0 break-words font-mono text-[12.5px]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!compact ? (
                  <div className="mt-auto border-t border-line px-4 py-2.5">
                    <Link
                      href={viewPath(ws.pid, b.edit.view)}
                      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-signal-text hover:underline"
                    >
                      {b.edit.label}
                      <ArrowRight size={12} weight="bold" />
                    </Link>
                  </div>
                ) : null}
              </motion.article>
              {i < blocks.length - 1 ? <Connector index={i} live={live && i < 2} calm={!!calm} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The arrow between two blocks: drawn in after the blocks arrive, with a moving pulse while training runs. */
function Connector({ index, live, calm }: { index: number; live: boolean; calm: boolean }) {
  return (
    <span
      className="pointer-events-none absolute left-1/2 top-full block h-4 w-px -translate-x-1/2 @[640px]:hidden @[1000px]:left-full @[1000px]:top-1/2 @[1000px]:block @[1000px]:h-px @[1000px]:w-8 @[1000px]:translate-x-0"
      aria-hidden
    >
      <motion.span
        className="absolute inset-0 origin-left bg-line-strong"
        initial={calm ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.35 + index * 0.08 }}
      />
      {live && !calm
        ? [0, 0.6].map((delay) => (
            <motion.span
              key={delay}
              className="absolute left-0 top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-signal"
              initial={{ x: 0, opacity: 0 }}
              animate={{ x: [0, 32], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.2, ease: "linear", repeat: Infinity, delay }}
            />
          ))
        : null}
    </span>
  );
}
