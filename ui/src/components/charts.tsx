import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { num } from "../format";
import { SOFT_SPRING } from "../motion";
import { Segmented, cx } from "./ui";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const color = (k: number) => SERIES[k % SERIES.length];

/** The rendered width of a chart's box, so the SVG draws at real pixels and its text never scales. */
function useWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}

/**
 * Round tick positions for [lo, hi]: steps of 1, 2 or 5 times a power of ten. With `cover` the outer ticks
 * enclose the range, so the axis can start and end on them; without it every tick falls inside the range.
 */
export function niceTicks(lo: number, hi: number, count = 5, cover = false) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [] as number[], step: 1 };
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const first = cover ? Math.floor(lo / step + 1e-9) * step : Math.ceil(lo / step - 1e-9) * step;
  const last = cover ? Math.ceil(hi / step - 1e-9) * step : hi;
  for (let v = first; v <= last + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)) || 0);
  return { ticks, step };
}

const digitsFor = (step: number) => Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));

/** A read-out value, without the "-0.00" that rounding a tiny negative number gives. */
const reading = (v: number | undefined, digits: number) => (v === undefined ? "–" : num(Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v, digits));

/** Keeps the first and last tick labels inside the plot instead of half cut off. */
const anchor = (x: number, left: number, right: number) => (x > right - 24 ? "end" : x < left + 12 ? "start" : "middle");

/** Clickable legend entries that hide or show a series. At least one stays visible. */
function Legend({ names, hidden, onToggle }: { names: string[]; hidden?: Set<string>; onToggle?: (name: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-1 gap-y-1 text-[12.5px] text-ink-2">
      {names.map((n, k) => {
        const off = hidden?.has(n);
        const body = (
          <>
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: off ? "var(--surface-3)" : color(k) }} />
            <span className={cx(off && "line-through decoration-ink-3")}>{n}</span>
          </>
        );
        return onToggle ? (
          <button
            key={n}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(n)}
            className="inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-0.5 hover:bg-surface-2"
          >
            {body}
          </button>
        ) : (
          <span key={n} className="inline-flex items-center gap-1.5 px-1.5 py-0.5">
            {body}
          </span>
        );
      })}
    </div>
  );
}

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const right = x > width * 0.62;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-[120px] rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-float"
      style={right ? { right: width - x + 10 } : { left: x + 10 }}
    >
      {children}
    </div>
  );
}

function useHidden(names: string[]) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(name)) next.delete(name);
      else if (names.length - next.size > 1) next.add(name);
      return next;
    });
  return { hidden, toggle };
}

export interface Line {
  name: string;
  values: number[];
}

/**
 * Lines over an evenly spaced x axis, with gridlines, axis titles, a read-out under the pointer (or the arrow
 * keys) and a legend that hides lines. `band` shades a span of x, such as the length of one window.
 */
export function LineChart({
  series,
  dx,
  x0 = 0,
  xTitle,
  yTitle,
  formatX,
  band,
  height = 200,
  label,
}: {
  series: Line[];
  dx: number;
  x0?: number;
  xTitle: string;
  yTitle?: string;
  formatX: (v: number) => string;
  band?: { from: number; to: number; label: string };
  height?: number;
  label: string;
}) {
  const { ref, width } = useWidth();
  const { hidden, toggle } = useHidden(series.map((s) => s.name));
  const [at, setAt] = useState<number | null>(null);
  const shown = series.filter((s) => !hidden.has(s.name));
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const all = shown.flatMap((s) => s.values);
  const pad = (Math.max(...all) - Math.min(...all)) * 0.04 || 1;
  const y = niceTicks(Math.min(...all) - pad, Math.max(...all) + pad, 4, true);
  const lo = y.ticks[0];
  const hi = y.ticks[y.ticks.length - 1];
  const xEnd = x0 + (n - 1) * dx;
  const x = niceTicks(x0, xEnd, Math.max(2, Math.floor(width / 110)));
  const L = 52;
  const R = 12;
  const T = 10;
  const B = 38;
  const pw = Math.max(10, width - L - R);
  const ph = height - T - B;
  const sx = (v: number) => L + ((v - x0) / (xEnd - x0 || 1)) * pw;
  const sy = (v: number) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const yd = digitsFor(y.step);

  const move = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setAt(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  const key = (e: KeyboardEvent) => {
    const jump = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight") setAt((a) => Math.min(n - 1, (a ?? -1) + jump));
    else if (e.key === "ArrowLeft") setAt((a) => Math.max(0, (a ?? n) - jump));
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="relative rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        tabIndex={0}
        onKeyDown={key}
        onBlur={() => setAt(null)}
        aria-label={`${label}. Use the arrow keys to read values.`}
      >
        <svg width={width} height={height} className="block" role="img" aria-label={label}>
          <g fontSize="11" fontFamily="var(--font-mono)" fill="var(--ink-3)">
            {y.ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={L + pw} y1={sy(t)} y2={sy(t)} stroke="var(--line)" />
                <text x={L - 8} y={sy(t) + 3.5} textAnchor="end">
                  {num(t, yd)}
                </text>
              </g>
            ))}
            {x.ticks.map((t) => (
              <g key={t}>
                <line x1={sx(t)} x2={sx(t)} y1={T} y2={T + ph} stroke="var(--line)" strokeDasharray="2 3" />
                <text x={sx(t)} y={T + ph + 15} textAnchor={anchor(sx(t), L, L + pw)}>
                  {formatX(t)}
                </text>
              </g>
            ))}
          </g>
          <text x={L + pw / 2} y={height - 4} textAnchor="middle" fontSize="11.5" fill="var(--ink-2)">
            {xTitle}
          </text>
          {yTitle ? (
            <text transform={`translate(11 ${T + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fill="var(--ink-2)">
              {yTitle}
            </text>
          ) : null}
          {band && band.to < xEnd ? (
            <g>
              <rect
                x={sx(band.from)}
                y={T}
                width={sx(band.to) - sx(band.from)}
                height={ph}
                fill="var(--signal)"
                fillOpacity={0.07}
                stroke="var(--signal)"
                strokeOpacity={0.5}
                strokeDasharray="4 3"
              />
              <text x={sx(band.from) + 6} y={T + 13} fontSize="11" fill="var(--signal-text)">
                {band.label}
              </text>
            </g>
          ) : null}
          {series.map((s, k) =>
            hidden.has(s.name) ? null : (
              <polyline
                key={s.name}
                points={s.values.map((v, i) => `${sx(x0 + i * dx).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={color(k)}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ),
          )}
          {at !== null ? (
            <g>
              <line x1={sx(x0 + at * dx)} x2={sx(x0 + at * dx)} y1={T} y2={T + ph} stroke="var(--ink-3)" />
              {series.map((s, k) =>
                hidden.has(s.name) || s.values[at] === undefined ? null : (
                  <circle
                    key={s.name}
                    cx={sx(x0 + at * dx)}
                    cy={sy(s.values[at])}
                    r={3.5}
                    fill="var(--surface)"
                    stroke={color(k)}
                    strokeWidth={2}
                  />
                ),
              )}
            </g>
          ) : null}
          <rect
            x={L}
            y={T}
            width={pw}
            height={ph}
            fill="transparent"
            onPointerMove={move}
            onPointerDown={move}
            onPointerLeave={() => setAt(null)}
          />
        </svg>
        {at !== null ? (
          <Tip x={sx(x0 + at * dx)} width={width}>
            <div className="mb-0.5 font-mono text-ink-3">{formatX(x0 + at * dx)}</div>
            {series.map((s, k) =>
              hidden.has(s.name) ? null : (
                <div key={s.name} className="flex items-center gap-2">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: color(k) }} />
                  <span className="grow text-ink-2">{s.name}</span>
                  <span className="font-mono">{reading(s.values[at], Math.max(2, yd))}</span>
                </div>
              ),
            )}
          </Tip>
        ) : null}
      </div>
      {series.length > 1 ? <Legend names={series.map((s) => s.name)} hidden={hidden} onToggle={toggle} /> : null}
    </figure>
  );
}

/** One recording over time. Ticks read in milliseconds below two seconds, in seconds above. */
export function SignalChart({ series, rate, label, window }: { series: Line[]; rate: number; label: string; window?: number }) {
  const seconds = (Math.max(...series.map((s) => s.values.length)) - 1) / rate;
  const ms = seconds <= 2.5;
  return (
    <LineChart
      series={series}
      dx={1 / rate}
      xTitle="Time"
      yTitle="Reading"
      formatX={(t) => (ms ? `${num(t * 1000)} ms` : `${num(t, 1)} s`)}
      band={window ? { from: 0, to: window, label: `One window, ${num(window * 1000)} ms` } : undefined}
      label={label}
    />
  );
}

/**
 * How strong each frequency is in a recording: the mean removed, a Hann window applied and a discrete
 * Fourier transform taken. Returns log10 power per bin from 0 Hz to half the sample rate.
 */
export function spectrum(values: number[], rate: number) {
  const n = values.length;
  const mean = values.reduce((a, v) => a + v, 0) / (n || 1);
  const w = values.map((v, i) => (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(n - 1, 1))));
  const bins = Math.floor(n / 2) + 1;
  const out: number[] = [];
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * k * i) / n;
      re += w[i] * Math.cos(a);
      im -= w[i] * Math.sin(a);
    }
    out.push(Math.log10((re * re + im * im) / n + 1e-9));
  }
  return { values: out, dx: rate / n };
}

export function SpectrumChart({ series, rate, label }: { series: Line[]; rate: number; label: string }) {
  const spectra = series.map((s) => ({ name: s.name, ...spectrum(s.values, rate) }));
  return (
    <LineChart
      series={spectra.map((s) => ({ name: s.name, values: s.values }))}
      dx={spectra[0]?.dx ?? 1}
      xTitle="Frequency"
      yTitle="Power (log)"
      formatX={(f) => `${num(f, f < 10 && f % 1 ? 1 : 0)} Hz`}
      label={label}
    />
  );
}

/**
 * How one measurement spreads for each kind of data, as overlapping step areas. The pointer (or arrow keys)
 * reads the window count in each bin; `thresholds` draw the alert line.
 */
export function Histogram({
  bins,
  hist,
  thresholds = [],
  label,
  xTitle,
}: {
  bins: number[];
  hist: Record<string, number[]>;
  thresholds?: number[];
  label: string;
  xTitle: string;
}) {
  const { ref, width } = useWidth();
  const names = Object.keys(hist);
  const { hidden, toggle } = useHidden(names);
  const [at, setAt] = useState<number | null>(null);
  const [mode, setMode] = useState<"count" | "share">("count");
  const totals = Object.fromEntries(names.map((c) => [c, hist[c].reduce((a, v) => a + v, 0) || 1]));
  const value = (c: string, i: number) => (mode === "share" ? hist[c][i] / totals[c] : hist[c][i]);
  const height = 220;
  const L = 52;
  const R = 12;
  const T = 12;
  const B = 38;
  const pw = Math.max(10, width - L - R);
  const ph = height - T - B;
  const count = bins.length - 1;
  const max = Math.max(
    mode === "share" ? 0.01 : 1,
    ...names.filter((c) => !hidden.has(c)).flatMap((c) => hist[c].map((_, i) => value(c, i))),
  );
  const y = niceTicks(0, max, 4, true);
  const top = y.ticks[y.ticks.length - 1] || 1;
  const x = niceTicks(bins[0], bins[count], Math.max(2, Math.floor(width / 110)));
  const sx = (v: number) => L + ((v - bins[0]) / (bins[count] - bins[0] || 1)) * pw;
  const sy = (c: number) => T + ph - (c / top) * ph;
  const xd = digitsFor(x.step);

  const move = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setAt(Math.max(0, Math.min(count - 1, Math.floor(((e.clientX - box.left) / box.width) * count))));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setAt((a) => Math.min(count - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setAt((a) => Math.max(0, (a ?? count) - 1));
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="relative rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        tabIndex={0}
        onKeyDown={key}
        onBlur={() => setAt(null)}
        aria-label={`${label}. Use the arrow keys to read each bin.`}
      >
        <svg width={width} height={height} className="block" role="img" aria-label={label}>
          <g fontSize="11" fontFamily="var(--font-mono)" fill="var(--ink-3)">
            {y.ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={L + pw} y1={sy(t)} y2={sy(t)} stroke="var(--line)" />
                <text x={L - 8} y={sy(t) + 3.5} textAnchor="end">
                  {mode === "share" ? `${num(t * 100)}%` : num(t)}
                </text>
              </g>
            ))}
            {x.ticks.map((t) => (
              <text key={t} x={sx(t)} y={T + ph + 15} textAnchor={anchor(sx(t), L, L + pw)}>
                {num(t, xd)}
              </text>
            ))}
          </g>
          <text x={L + pw / 2} y={height - 4} textAnchor="middle" fontSize="11.5" fill="var(--ink-2)">
            {xTitle}
          </text>
          <text transform={`translate(11 ${T + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fill="var(--ink-2)">
            {mode === "share" ? "Share of label" : "Windows"}
          </text>
          {at !== null ? <rect x={sx(bins[at])} y={T} width={sx(bins[at + 1]) - sx(bins[at])} height={ph} fill="var(--surface-2)" /> : null}
          {names.map((name, k) => {
            if (hidden.has(name)) return null;
            const pts = hist[name].map(
              (c, i) => `${sx(bins[i]).toFixed(1)},${sy(c).toFixed(1)} ${sx(bins[i + 1]).toFixed(1)},${sy(c).toFixed(1)}`,
            );
            return (
              <polyline
                key={name}
                points={`${sx(bins[0])},${sy(0)} ${pts.join(" ")} ${sx(bins[count])},${sy(0)}`}
                fill={color(k)}
                fillOpacity={0.16}
                stroke={color(k)}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            );
          })}
          {thresholds.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={T} y2={T + ph} stroke="var(--block)" strokeWidth={1.5} strokeDasharray="4 3" />
              <text
                x={sx(t) + (sx(t) > L + pw - 130 ? -6 : 6)}
                y={T + 12}
                fill="var(--block)"
                fontSize="11.5"
                textAnchor={sx(t) > L + pw - 130 ? "end" : "start"}
              >
                Alert above {num(t, 4)}
              </text>
            </g>
          ))}
          <rect
            x={L}
            y={T}
            width={pw}
            height={ph}
            fill="transparent"
            onPointerMove={move}
            onPointerDown={move}
            onPointerLeave={() => setAt(null)}
          />
        </svg>
        {at !== null ? (
          <Tip x={sx((bins[at] + bins[at + 1]) / 2)} width={width}>
            <div className="mb-0.5 font-mono text-ink-3">
              {num(bins[at], xd + 1)} to {num(bins[at + 1], xd + 1)}
            </div>
            {names.map((name, k) =>
              hidden.has(name) ? null : (
                <div key={name} className="flex items-center gap-2">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: color(k) }} />
                  <span className="grow text-ink-2">{name}</span>
                  <span className="font-mono">{mode === "share" ? `${num(value(name, at) * 100, 1)}%` : num(hist[name][at])}</span>
                </div>
              ),
            )}
          </Tip>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <div className="grow">
          <Legend names={names} hidden={hidden} onToggle={names.length > 1 ? toggle : undefined} />
        </div>
        {names.length > 1 ? (
          <div className="mt-2">
            <Segmented
              label="Scale"
              value={mode}
              onChange={setMode}
              options={[
                ["count", "Windows"],
                ["share", "Share of each label"],
              ]}
            />
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** Precision, recall and F1 for each class, read from a confusion matrix whose rows are the true class. */
export function classScores(matrix: number[][]) {
  const total = matrix.flat().reduce((a, v) => a + v, 0);
  const rows = matrix.map((row, k) => {
    const tp = row[k] ?? 0;
    const actual = row.reduce((a, v) => a + v, 0);
    const predicted = matrix.reduce((a, r) => a + (r[k] ?? 0), 0);
    const recall = actual ? tp / actual : null;
    const precision = predicted ? tp / predicted : null;
    const f1 = recall != null && precision != null && recall + precision ? (2 * recall * precision) / (recall + precision) : null;
    return { actual, recall, precision, f1 };
  });
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  };
  return {
    rows,
    total,
    accuracy: total ? matrix.reduce((a, r, k) => a + (r[k] ?? 0), 0) / total : null,
    recall: mean(rows.map((r) => r.recall)),
    precision: mean(rows.map((r) => r.precision)),
    f1: mean(rows.map((r) => r.f1)),
  };
}

const share = (v: number | null) => (v == null ? "–" : `${num(v * 100, v < 1 && v > 0.99 ? 1 : 0)}%`);

/**
 * Test results as a grid: rows are what really happened, columns what the model answered. Each cell shows the
 * share of its row, with the window count underneath; right answers sit on the diagonal.
 */
export function Confusion({ matrix, classes }: { matrix: number[][]; classes: string[] }) {
  const scores = classScores(matrix);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] border-separate border-spacing-[3px] text-[12.5px]">
        <thead>
          <tr>
            <th className="px-2 pb-1 text-left text-[11.5px] font-medium text-ink-3">Real ↓ / Answer →</th>
            {classes.map((c) => (
              <th key={c} className="px-2 pb-1 text-center font-mono text-[11.5px] font-medium text-ink-2">
                {c}
              </th>
            ))}
            <th className="px-2 pb-1 text-center text-[11.5px] font-medium text-ink-3">Recall</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={classes[i]}>
              <th className="whitespace-nowrap px-2 text-left font-mono text-[11.5px] font-medium text-ink-2">{classes[i]}</th>
              {row.map((v, j) => {
                const s = scores.rows[i].actual ? v / scores.rows[i].actual : 0;
                const right = i === j;
                const strong = right && s >= 0.5;
                return (
                  <td
                    key={j}
                    title={`${classes[i]} answered as ${classes[j]}: ${v} windows`}
                    className={cx(
                      "h-11 min-w-[56px] rounded-[4px] px-1 text-center align-middle",
                      strong ? "font-semibold text-on-ink" : "text-ink",
                    )}
                    style={{
                      background: strong
                        ? "var(--ok)"
                        : right && s > 0
                          ? "color-mix(in srgb, var(--ok) 22%, var(--surface))"
                          : !right && v
                            ? `color-mix(in srgb, var(--block) ${Math.round(10 + Math.min(s, 0.5) * 50)}%, var(--surface))`
                            : "var(--surface-2)",
                    }}
                  >
                    <div className="font-mono">{share(s)}</div>
                    <div className={cx("text-[10.5px]", strong ? "opacity-85" : "text-ink-3")}>{v}</div>
                  </td>
                );
              })}
              <td className="px-2 text-center font-mono">{share(scores.rows[i].recall)}</td>
            </tr>
          ))}
          <tr>
            <th className="px-2 pt-1 text-left text-[11.5px] font-medium text-ink-3">Precision</th>
            {scores.rows.map((r, k) => (
              <td key={k} className="px-2 pt-1 text-center font-mono">
                {share(r.precision)}
              </td>
            ))}
            <td />
          </tr>
          <tr>
            <th className="px-2 text-left text-[11.5px] font-medium text-ink-3">F1 score</th>
            {scores.rows.map((r, k) => (
              <td key={k} className="px-2 text-center font-mono">
                {r.f1 == null ? "–" : num(r.f1, 2)}
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export interface Bar {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  value: number | null;
  text: ReactNode;
  tone?: "signal" | "ok" | "warn" | "muted";
  current?: boolean;
}

const BAR_TONE = { signal: "bg-signal", ok: "bg-ok", warn: "bg-warn", muted: "bg-line-strong" };

/**
 * Horizontal bars on one shared scale, with an optional target line. Each bar grows from zero once, so the
 * eye follows it to the target.
 */
export function BarList({
  items,
  goal,
  max,
  label,
}: {
  items: Bar[];
  goal?: { value: number; label: string };
  max?: number;
  label: string;
}) {
  const calm = useReducedMotion();
  const top = max ?? Math.max(goal?.value ?? 0, ...items.map((i) => i.value ?? 0)) * 1.05;
  return (
    <div role="list" aria-label={label} className="space-y-2.5">
      {items.map((it, k) => (
        <div
          role="listitem"
          key={it.key}
          className={cx(
            "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[7px] px-2 py-1.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]",
            it.current && "bg-signal-wash",
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{it.label}</div>
            {it.sub ? <div className="truncate text-[12px] text-ink-3">{it.sub}</div> : null}
          </div>
          <div className="relative h-2.5 rounded-full bg-surface-3">
            {it.value != null && top > 0 ? (
              <motion.div
                className={cx("absolute inset-y-0 left-0 w-full origin-left rounded-full", BAR_TONE[it.tone ?? "signal"])}
                initial={calm ? false : { scaleX: 0 }}
                animate={{ scaleX: Math.max(0.01, Math.min(1, it.value / top)) }}
                transition={{ ...SOFT_SPRING, delay: 0.05 + k * 0.04 }}
              />
            ) : null}
            {goal && top > 0 ? (
              <div
                className="absolute -bottom-1 -top-1 w-0.5 rounded bg-ink"
                style={{ left: `calc(${Math.min(1, goal.value / top) * 100}% - 1px)` }}
                title={goal.label}
              />
            ) : null}
          </div>
          <div className="whitespace-nowrap text-right text-[12.5px]">{it.text}</div>
        </div>
      ))}
      {goal ? (
        <div className="flex items-center gap-1.5 px-2 text-[12px] text-ink-3">
          <span className="inline-block h-3 w-0.5 rounded bg-ink" aria-hidden /> {goal.label}
        </div>
      ) : null}
    </div>
  );
}

/** Used against available, the way a tuner card shows it: the label and share, "2 ms of 100 ms", a thin bar. */
export function BudgetBar({ label, used, of, share: s }: { label: string; used: ReactNode; of?: string; share: number | null }) {
  const calm = useReducedMotion();
  const tone = s == null ? "bg-line-strong" : s > 1 ? "bg-block" : s > 0.8 ? "bg-warn" : "bg-signal";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="font-medium text-ink-3">{label}</span>
        {s != null ? (
          <span className={cx("ml-auto font-mono", s > 1 ? "text-block" : "text-ink-3")}>
            {s > 0 && s < 0.001 ? "<0.1" : num(s * 100, s < 0.1 ? 1 : 0)}% used
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-[13px]">
        {used}
        {of ? <span className="text-ink-3"> of {of}</span> : null}
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {s != null ? (
          <motion.div
            className={cx("absolute inset-y-0 left-0 w-full origin-left rounded-full", tone)}
            initial={calm ? false : { scaleX: 0 }}
            animate={{ scaleX: Math.max(0.015, Math.min(1, s)) }}
            transition={{ ...SOFT_SPRING, delay: 0.08 }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A small ring split by share, for the summary cards. */
export function Donut({ parts, size = 44, label }: { parts: { name: string; value: number }[]; size?: number; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 15.9155;
  let at = 0;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label={label} className="-rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
      {parts.map((p, k) => {
        const part = (p.value / total) * 100;
        const offset = at;
        at += part;
        return (
          <circle
            key={p.name}
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke={color(k)}
            strokeWidth="5"
            strokeDasharray={`${Math.max(part - 0.6, 0)} ${100 - Math.max(part - 0.6, 0)}`}
            strokeDashoffset={-offset}
          >
            <title>{`${p.name}: ${Math.round(part)}%`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

/** A thumbnail of a recording: every axis as one line, scaled to the shared range. */
export function Sparkline({ series, label }: { series: Line[]; label: string }) {
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(...all);
  const span = Math.max(...all) - lo || 1;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={label}>
      {series.map((s, k) => (
        <polyline
          key={s.name}
          fill="none"
          stroke={color(k)}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
          points={s.values.map((v, i) => `${(i / Math.max(s.values.length - 1, 1)) * 100},${38 - ((v - lo) / span) * 36}`).join(" ")}
        />
      ))}
    </svg>
  );
}
