import { ArrowClockwise, ArrowRight, Check, Cpu, Package, Play, Prohibit } from "@phosphor-icons/react";
import { Link, useLocation } from "wouter";
import { api } from "../api";
import { useState } from "react";
import { BarList, BudgetBar } from "../components/charts";
import { ActionBar, Button, Callout, Disclosure, Empty, PageHeader, Reading, SectionTitle, Segmented, Status } from "../components/ui";
import { backTo, useAction, useJobs, useWorkspace, stepPath } from "../data";
import { bytes, cap, kb, num } from "../format";
import type { ChipResult, Tagged } from "../types";
import { motion, useReducedMotion } from "motion/react";
import { Reveal, SOFT_SPRING } from "../motion";
import { GateNotice, RunningBanner, useRunning } from "./shared";

export function Compare() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const jobs = useJobs();
  const test = useAction();
  const build = useAction();
  const d = ws.data;
  const running = useRunning(["rank"]);
  const calm = useReducedMotion();
  const anyJob = !!d.active_job || ws.needsApproval("model");

  if (ws.singleChip) {
    return (
      <div>
        <PageHeader title="Benchmark" />
        <Empty
          icon={Cpu}
          title={`You chose one chip: ${ws.chipName(ws.singleChip)}`}
          action={
            <>
              <Link href={stepPath(ws.pid, "build")} className="btn btn-primary">
                Open Deploy <ArrowRight size={15} weight="bold" className="nudge" />
              </Link>
              <Link href={stepPath(ws.pid, "target")} className="btn">
                Choose more chips
              </Link>
            </>
          }
        >
          With one chip there is nothing to compare. Deployment builds for it directly.
        </Empty>
      </div>
    );
  }

  const ranked = d.chip_results.filter((r) => r.rank).sort((a, b) => a.rank! - b.rank!);
  const leftOut = d.chip_results.filter((r) => !r.rank);
  const spec = d.project.spec!;
  const count = d.chip_ids.length || ws.catalog.chips.filter((c) => spec.vendor === "any" || c.vendor === spec.vendor).length;
  const gated = ws.needsApproval("model");

  const buildFor = (chipId: string) =>
    build.run(async () => {
      if (ws.needsApproval("rank"))
        await api(`/projects/${ws.pid}/reviews`, { json: { stage: "rank", status: "approved", note: `Chose ${ws.chipName(chipId)}` } });
      await jobs.start("build", { chip_id: chipId });
      navigate(stepPath(ws.pid, "build"));
    });

  const testButton = (
    <Button
      variant={ranked.length ? "default" : "primary"}
      icon={ranked.length ? ArrowClockwise : Play}
      disabled={!!running || gated}
      busy={test.busy}
      onClick={() => test.run(() => jobs.start("rank"))}
    >
      {ranked.length ? "Test again" : `Test on ${count} chips`}
    </Button>
  );

  const top = ranked[0];
  const c = (id: string) => ws.chip(id)?.family ?? ws.chipName(id);
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));

  return (
    <div>
      <PageHeader
        title="Benchmark"
        lede="Each chip is built with its own compiler and run in an emulator."
        actions={d.chip_results.length ? testButton : undefined}
      />
      <GateNotice stage="model" verb="testing on chips" />
      {running ? <RunningBanner job={running} text="Building and testing on each chip…" /> : null}

      {!d.chip_results.length ? (
        running ? null : (
          <Empty icon={Cpu} title="Not tested yet" action={testButton}>
            Press “Test on {count} chips”. Builds take a few seconds each, and chips with the same processor share one.
          </Empty>
        )
      ) : (
        <div className="space-y-8">
          {!ranked.length ? (
            <Callout level="block" title="No chip passed every requirement">
              The reasons are under Left out. Loosen the budget or radio, or choose other chips in Targets.
            </Callout>
          ) : null}

          {top ? (
            <Reveal key={top.id}>
              <TopPick r={top} />
            </Reveal>
          ) : null}

          {ranked.length > 1 ? (
            <Reveal order={1}>
              <ChipChart ranked={ranked} />
            </Reveal>
          ) : null}

          {ranked.length > 1 ? (
            <Reveal order={2}>
              <section>
                <SectionTitle title={`All ${ranked.length} chips that passed`} hint="ranked by your priority" />
                <div className="panel overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-8">#</th>
                        <th>Chip and price</th>
                        <th>Score</th>
                        <th className="num">Time and energy per answer</th>
                        <th>Memory used</th>
                        <th>Parity</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((r) => {
                        const m = r.measurement;
                        const c = ws.chip(r.chip_id);
                        return (
                          <tr key={r.id} className={r.rank === 1 ? "bg-signal-wash/50" : undefined}>
                            <td className="font-mono">{r.rank}</td>
                            <td className="min-w-[130px]">
                              <div className="font-semibold">{c?.family ?? r.chip_id}</div>
                              <div className="font-mono text-[12px] text-ink-3">{c?.part_number}</div>
                              <div className="mt-0.5 font-mono text-[12px]">
                                <Reading n={m.price_usd} render={(v) => `$${num(v, 2)}`} />
                              </div>
                            </td>
                            <td className="whitespace-nowrap">
                              <span className="mr-2 inline-block h-1.5 w-14 overflow-hidden rounded-full bg-surface-3 align-middle">
                                <motion.span
                                  className="block h-full w-full origin-left rounded-full bg-ink"
                                  initial={calm ? false : { scaleX: 0 }}
                                  animate={{ scaleX: r.score / maxScore }}
                                  transition={{ ...SOFT_SPRING, delay: 0.1 + (r.rank ?? 0) * 0.04 }}
                                />
                              </span>
                              <span className="font-mono text-[12.5px]">{num(r.score)}</span>
                            </td>
                            <td className="num">
                              <div>
                                <Reading n={m.latency_ms} render={(v) => `${num(v, 3)} ms`} />
                              </div>
                              <div className="mt-1 text-ink-2">
                                <Reading n={m.energy_uj} render={(v) => `${num(v, 2)} µJ`} />
                              </div>
                            </td>
                            <td className="min-w-[190px]">
                              <div className="space-y-2">
                                <BudgetBar
                                  label="Flash"
                                  used={<Reading n={m.flash_bytes} render={bytes} />}
                                  of={c ? kb(c.flash_kb) : undefined}
                                  share={c && m.flash_bytes?.value ? m.flash_bytes.value / (c.flash_kb * 1024) : null}
                                />
                                <BudgetBar
                                  label="RAM"
                                  used={<Reading n={m.ram_bytes} render={bytes} />}
                                  of={c ? kb(c.ram_kb) : undefined}
                                  share={c && m.ram_bytes?.value ? m.ram_bytes.value / (c.ram_kb * 1024) : null}
                                />
                              </div>
                            </td>
                            <td>
                              {m.parity_ok ? (
                                <Status tone="ok">
                                  <Check size={12} weight="bold" />
                                  {m.parity_detail?.label_matches}/{m.parity_detail?.windows}
                                </Status>
                              ) : (
                                <Status tone="block">No</Status>
                              )}
                            </td>
                            <td className="text-right">
                              <Button size="sm" disabled={anyJob} onClick={() => buildFor(r.chip_id)}>
                                Build
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </Reveal>
          ) : null}

          {leftOut.length ? <LeftOut rows={leftOut} /> : null}
        </div>
      )}

      <ActionBar
        back={backTo(ws.pid, "rank")}
        note={top ? `Next: Deployment. Builds the signed package for ${c(top.chip_id)}.` : "Next: Deployment, once a chip passes."}
      >
        {top ? (
          <Button variant="primary" size="lg" icon={Package} disabled={anyJob} busy={build.busy} onClick={() => buildFor(top.chip_id)}>
            Build for {c(top.chip_id)}
          </Button>
        ) : null}
      </ActionBar>
    </div>
  );
}

type Metric = "latency" | "energy" | "battery" | "price" | "flash" | "ram";

const METRICS: Record<
  Metric,
  { name: string; pick: (r: ChipResult) => Tagged | null | undefined; render: (v: number) => string; more?: boolean }
> = {
  latency: { name: "Time per answer", pick: (r) => r.measurement.latency_ms, render: (v) => `${num(v, 3)} ms` },
  energy: { name: "Energy per answer", pick: (r) => r.measurement.energy_uj, render: (v) => `${num(v, 2)} µJ` },
  battery: { name: "Battery", pick: (r) => r.measurement.battery_days, render: (v) => `${num(v)} days`, more: true },
  price: { name: "Chip price", pick: (r) => r.measurement.price_usd, render: (v) => `$${num(v, 2)}` },
  flash: { name: "Flash", pick: (r) => r.measurement.flash_bytes, render: bytes },
  ram: { name: "RAM", pick: (r) => r.measurement.ram_bytes, render: bytes },
};

/** The passing chips on one scale for the measure picked, best first. The top pick is highlighted. */
function ChipChart({ ranked }: { ranked: ChipResult[] }) {
  const ws = useWorkspace();
  const spec = ws.data.project.spec!;
  const options = (Object.keys(METRICS) as Metric[]).filter((k) => ranked.some((r) => METRICS[k].pick(r)?.value != null));
  const [metric, setMetric] = useState<Metric>(options[0] ?? "latency");
  const def = METRICS[metric];
  const rows = [...ranked].sort((a, b) => {
    const x = def.pick(a)?.value ?? null;
    const y = def.pick(b)?.value ?? null;
    if (x == null || y == null) return x == null ? 1 : -1;
    return def.more ? y - x : x - y;
  });
  const goal =
    metric === "latency" && spec.max_latency_ms
      ? { value: spec.max_latency_ms, label: `Your limit ${num(spec.max_latency_ms)} ms` }
      : undefined;
  const values = rows.map((r) => def.pick(r)?.value ?? 0);
  return (
    <section className="panel px-4 py-4" aria-labelledby="chip-chart">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-2">
        <h2 id="chip-chart" className="grow text-[15px] font-semibold">
          Compare chips <span className="font-normal text-ink-3">· {def.more ? "longer is better" : "shorter is better"}</span>
        </h2>
        <Segmented label="Measure" value={metric} onChange={setMetric} options={options.map((k) => [k, METRICS[k].name])} />
      </div>
      <BarList
        key={metric}
        label={`${def.name} for each chip`}
        max={Math.max(...values, goal && goal.value < Math.max(...values) * 4 ? goal.value : 0) * 1.05 || undefined}
        goal={goal && goal.value < Math.max(...values) * 4 ? goal : undefined}
        items={rows.map((r) => {
          const chip = ws.chip(r.chip_id);
          return {
            key: r.id,
            label: chip?.family ?? r.chip_id,
            sub: chip?.part_number,
            value: def.pick(r)?.value ?? null,
            tone: r.rank === 1 ? "signal" : "muted",
            current: r.rank === 1,
            text: <Reading n={def.pick(r)} render={def.render} />,
          };
        })}
      />
    </section>
  );
}

function TopPick({ r }: { r: ChipResult }) {
  const ws = useWorkspace();
  const c = ws.chip(r.chip_id);
  const m = r.measurement;
  return (
    <section className="panel overflow-hidden" aria-labelledby="top-pick">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-signal-text">Best match for your priority</div>
          <h2 id="top-pick" className="mt-1 text-[22px] font-semibold">
            {c?.family ?? r.chip_id}
          </h2>
          <p className="text-[13px] text-ink-3">
            {c ? `${ws.vendorName(c.vendor)} · ` : ""}
            <span className="font-mono">{c?.part_number}</span>
            {c ? ` · ${c.core_description}` : ""}
          </p>
          <ul className="mt-4 space-y-1.5">
            {r.reasons.map((x) => (
              <li key={x} className="flex gap-2">
                <Check size={15} weight="bold" className="mt-0.5 flex-none text-ok" />
                {cap(x)}
              </li>
            ))}
            {r.tradeoffs.map((x) => (
              <li key={x} className="flex gap-2 text-ink-2">
                <span className="mt-[9px] h-px w-3 flex-none bg-ink-3" aria-hidden />
                {cap(x)}
              </li>
            ))}
          </ul>
        </div>
        <dl className="spec-list self-start text-[13px]">
          <dt>Time per answer</dt>
          <dd>
            <Reading n={m.latency_ms} render={(v) => `${num(v, 3)} ms`} />
          </dd>
          <dt>Flash used</dt>
          <dd>
            <Reading n={m.flash_bytes} render={bytes} />
          </dd>
          <dt>RAM used</dt>
          <dd>
            <Reading n={m.ram_bytes} render={bytes} />
          </dd>
          <dt>Battery</dt>
          <dd>
            <Reading n={m.battery_days} render={(v) => `${num(v)} days`} />
          </dd>
          <dt>Chip price</dt>
          <dd>
            <Reading n={m.price_usd} render={(v) => `$${num(v, 2)}`} />
          </dd>
          <dt>Matches Python</dt>
          <dd>{m.parity_ok ? `${m.parity_detail?.label_matches} of ${m.parity_detail?.windows} windows` : "no"}</dd>
        </dl>
      </div>
    </section>
  );
}

function LeftOut({ rows }: { rows: ChipResult[] }) {
  const ws = useWorkspace();
  const why = (r: ChipResult) =>
    r.measurement.status === "skipped"
      ? "Its build tools are not installed on this computer."
      : cap(r.measurement.filtered_reason || r.measurement.error || r.measurement.status);
  const groups: [string, ChipResult[]][] = (
    [
      ["Did not meet your requirements or limits", rows.filter((r) => ["filtered", "ok"].includes(r.measurement.status))],
      ["Could not be tested on this computer", rows.filter((r) => r.measurement.status === "skipped")],
      ["Build failed", rows.filter((r) => r.measurement.status === "failed")],
    ] as [string, ChipResult[]][]
  ).filter(([, list]) => list.length);
  return (
    <Disclosure
      title={
        <span className="flex items-center gap-2">
          <Prohibit size={15} className="text-ink-3" /> Left out ({rows.length})
        </span>
      }
    >
      <div className="space-y-5">
        {groups.map(([title, list]) => (
          <div key={title}>
            <h3 className="mb-1.5 text-[13.5px] font-semibold">{title}</h3>
            <ul className="divide-y divide-line rounded-[8px] border border-line">
              {list.map((r) => (
                <li key={r.id} className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-3.5 py-2.5 text-[13px] sm:grid-cols-[200px_1fr]">
                  <span className="font-medium">{ws.chipName(r.chip_id)}</span>
                  <span className="text-ink-2">{why(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
