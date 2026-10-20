import {
  ArrowClockwise,
  Copy,
  Cpu,
  DownloadSimple,
  Eye,
  FileC,
  FileCode,
  FileText,
  Folder,
  Package,
  Play,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Link } from "wouter";
import { api, errorMessage } from "../api";
import { Markdown } from "../components/Markdown";
import { toast } from "../components/Toast";
import { BudgetBar } from "../components/charts";
import {
  ActionBar,
  Button,
  Callout,
  Disclosure,
  Empty,
  Modal,
  PageHeader,
  Reading,
  SectionTitle,
  StatCard,
  Status,
  cx,
} from "../components/ui";
import { backTo, useAction, useJobs, useWorkspace, stepPath } from "../data";
import { bytes, kb, num, relativeTime } from "../format";
import type { Build as BuildRow, PackageFile } from "../types";
import { Reveal, SPRING } from "../motion";
import { GateNotice, RunningBanner, useRunning } from "./shared";

export function Build() {
  const ws = useWorkspace();
  const jobs = useJobs();
  const action = useAction();
  const d = ws.data;
  const running = useRunning(["build"]);
  const chipId = running?.params?.chip_id ?? d.builds[0]?.chip_id ?? ws.singleChip;

  if (!chipId) {
    return (
      <div>
        <PageHeader title="Deployment" />
        <Empty
          icon={Cpu}
          title="Choose a chip first"
          action={
            <Link href={stepPath(ws.pid, "rank")} className="btn btn-primary">
              Open Benchmark
            </Link>
          }
        >
          Compare the chips, then press “Build” on the one you want.
        </Empty>
      </div>
    );
  }

  const chip = ws.chip(chipId);
  const builds = d.builds.filter((b) => b.chip_id === chipId);
  const b = running ? undefined : builds[0];
  const gated = ws.needsApproval("model");

  return (
    <div>
      <PageHeader
        title="Deployment"
        lede="The package is signed only when every test window gives the same answer on the chip as in Python."
        stats={
          b ? (
            <div className="grid grid-cols-2 gap-3 @[960px]:max-w-[640px]">
              <StatCard label="Package" value={`v${b.version}`} sub={b.passed ? "Signed" : "Blocked, not written"} />
              <StatCard
                label="Same answers as Python"
                value={`${b.parity.label_matches ?? 0} / ${b.parity.windows ?? 0}`}
                sub="test windows on the emulated chip"
              />
            </div>
          ) : undefined
        }
      />
      <GateNotice stage="model" verb="the build" />

      <div className="panel mb-6 flex flex-wrap items-center gap-4 px-4 py-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[8px] bg-surface-2">
          <Cpu size={20} />
        </span>
        <div className="min-w-0 grow">
          <div className="font-semibold">{ws.chipName(chipId)}</div>
          <div className="text-[13px] text-ink-3">
            {chip ? `${ws.vendorName(chip.vendor)} · ${chip.core_description} · ${num(chip.clock_mhz)} MHz` : ""}
          </div>
        </div>
        <Link href={stepPath(ws.pid, ws.singleChip ? "target" : "rank")} className="btn btn-sm btn-ghost">
          Change chip
        </Link>
        <Button
          variant={b ? "default" : "primary"}
          icon={b ? ArrowClockwise : Play}
          disabled={!!d.active_job || gated}
          busy={action.busy}
          onClick={() => action.run(() => jobs.start("build", { chip_id: chipId }))}
        >
          {b ? "Build again" : "Build for this chip"}
        </Button>
      </div>

      {running ? <RunningBanner job={running} text="Building and running every golden window…" /> : null}
      {b ? <BuildResult key={b.id} b={b} /> : null}
      {d.builds.length > 1 ? (
        <div className="mt-8">
          <EarlierBuilds builds={d.builds.filter((x) => x.id !== b?.id)} />
        </div>
      ) : null}

      <ActionBar
        back={ws.singleChip ? backTo(ws.pid, "rank") : backTo(ws.pid, "build")}
        note={
          b ? (b.passed ? `v${b.version} is signed and ready.` : "Blocked. Fix the cause and build again.") : "Build to get the package."
        }
      >
        {b?.package_path ? (
          <a className="btn btn-primary btn-lg" href={`/api/builds/${b.id}/download/essentials`}>
            <DownloadSimple size={16} weight="bold" /> Download .h and .c
          </a>
        ) : null}
      </ActionBar>
    </div>
  );
}

function BuildResult({ b }: { b: BuildRow }) {
  const parity = b.parity;
  const m = parity.measurement ?? ({} as NonNullable<typeof parity.measurement>);
  const golden = parity.windows ?? 0;
  const failed = new Set((parity.failures ?? []).map((f) => f.id));
  const calm = useReducedMotion();

  return (
    <div className="space-y-8">
      <Reveal>
        {b.passed ? null : (
          <Callout level="block" title="Blocked: no package was written">
            {parity.blocked_reason || "The firmware's answers did not match Python."} Fix the cause and build again.
          </Callout>
        )}
      </Reveal>

      <Reveal order={1}>
        <Performance b={b} />
      </Reveal>

      <Reveal order={2}>
        <section className="panel overflow-hidden" aria-labelledby="proof-title">
          <div className="px-5 py-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-ink-2" />
                <h2 id="proof-title" className="text-[15px] font-semibold">
                  Test windows
                </h2>
              </div>
              <p className="mt-1 text-[13px] text-ink-2">One square per test window. Green means the chip and Python agree.</p>
              <div
                className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(26px,1fr))] gap-1"
                role="img"
                aria-label={`${golden - failed.size} of ${golden} windows match`}
              >
                {Array.from({ length: golden }, (_, i) => (
                  <motion.span
                    key={i}
                    title={`Window ${i}: ${failed.has(i) ? "did not match" : "matched"}`}
                    initial={calm ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...SPRING, delay: 0.15 + i * Math.min(0.02, 0.6 / Math.max(golden, 1)) }}
                    className={cx(
                      "grid aspect-square place-items-center rounded-[4px] font-mono text-[10px]",
                      failed.has(i) ? "bg-block text-surface" : "bg-ok-wash text-ok",
                    )}
                  >
                    {i}
                  </motion.span>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-ink-3">
                Emulator: {m.emulator || "–"}. The largest feature difference used {(100 * (parity.worst_tolerance_used ?? 0)).toFixed(2)}%
                of its allowed tolerance{parity.worst_feature ? ` (${parity.worst_feature})` : ""}.
                {parity.borderline ? ` ${parity.borderline} window(s) were borderline and are reported, not failed.` : ""}
              </p>
            </div>
          </div>
        </section>
      </Reveal>

      {b.package_path ? (
        <Reveal order={3}>
          <Downloads b={b} />
        </Reveal>
      ) : null}
      {b.package_path ? <Report buildId={b.id} /> : null}
    </div>
  );
}

/** What the build costs on the chip next to what is available, the way a tuner card shows it. */
function Performance({ b }: { b: BuildRow }) {
  const ws = useWorkspace();
  const chip = ws.chip(b.chip_id);
  const spec = ws.data.project.spec;
  const m = b.parity.measurement ?? ({} as NonNullable<BuildRow["parity"]["measurement"]>);
  const of = (used: number | null | undefined, k: number | undefined) => (used != null && k ? used / (k * 1024) : null);
  return (
    <section className="panel overflow-hidden" aria-labelledby="perf-title">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-3">
        <h2 id="perf-title" className="text-[14px] font-semibold">
          On-device performance
        </h2>
        <span className="text-[12.5px] text-ink-3">{ws.chipName(b.chip_id)}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-3">
        <BudgetBar
          label="Time per answer"
          used={<Reading n={m.latency_ms} render={(v) => `${num(v, 3)} ms`} />}
          of={spec?.max_latency_ms ? `${num(spec.max_latency_ms)} ms limit` : undefined}
          share={m.latency_ms?.value != null && spec?.max_latency_ms ? m.latency_ms.value / spec.max_latency_ms : null}
        />
        <BudgetBar
          label="RAM"
          used={<Reading n={m.ram_bytes} render={bytes} />}
          of={chip ? kb(chip.ram_kb) : undefined}
          share={of(m.ram_bytes?.value, chip?.ram_kb)}
        />
        <BudgetBar
          label="Flash"
          used={<Reading n={m.flash_bytes} render={bytes} />}
          of={chip ? kb(chip.flash_kb) : undefined}
          share={of(m.flash_bytes?.value, chip?.flash_kb)}
        />
      </div>
      <dl className="grid grid-cols-2 border-t border-line text-[13px] sm:grid-cols-4">
        {(
          [
            ["Energy per answer", <Reading n={m.energy_uj} render={(v) => `${num(v, 2)} µJ`} />],
            ["Battery", <Reading n={m.battery_days} render={(v) => `${num(v)} days`} />],
            ["Stack", <Reading n={m.stack_bytes} render={bytes} />],
            ["Core", chip ? `${num(chip.clock_mhz)} MHz` : "–"],
          ] as [string, React.ReactNode][]
        ).map(([k, v]) => (
          <div key={k} className="border-line px-4 py-3 [&:not(:last-child)]:border-r">
            <dt className="text-[12px] font-medium text-ink-3">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function usageSnippet(task: string | undefined, rate: number | undefined) {
  const lines = [
    '#include "tinyml_model.h"',
    "",
    "/* Fill with TINYML_WINDOW_SAMPLES readings per axis, interleaved by axis,",
    ` * at TINYML_SAMPLE_RATE_HZ (${num(rate ?? 0)}) readings per second. */`,
    "static float window[TINYML_WINDOW_SAMPLES * TINYML_NUM_AXES];",
    "",
  ];
  if (task === "anomaly")
    lines.push(
      "/* Once, while the machine runs normally: */",
      "/* model_calibrate_begin(); model_calibrate_add(window) x 20; model_calibrate_end(); */",
      "",
    );
  lines.push("tinyml_result_t r = model_predict(window);", "const char *answer = tinyml_class_names[r.label];");
  return lines.join("\n");
}

const isSource = (p: string) => /\.(c|h|hpp|cpp)$/.test(p);

function Downloads({ b }: { b: BuildRow }) {
  const ws = useWorkspace();
  const [viewing, setViewing] = useState<string | null>(null);
  const files = useQuery({ queryKey: ["files", b.id], queryFn: () => api<PackageFile[]>(`/builds/${b.id}/files`) });
  const list = files.data ?? [];
  const essentials = list.filter((f) => f.essential);
  const total = list.reduce((n, f) => n + f.bytes, 0);
  const folders = new Map<string, PackageFile[]>();
  list.forEach((f) => {
    const dir = f.path.includes("/") ? `${f.path.split("/")[0]}/` : "package root";
    folders.set(dir, [...(folders.get(dir) ?? []), f]);
  });

  const row = (f: PackageFile) => (
    <li key={f.path} className="flex items-start gap-2.5 px-3 py-2.5">
      {isSource(f.path) ? (
        <FileC size={16} className="mt-0.5 flex-none text-ink-2" />
      ) : (
        <FileText size={16} className="mt-0.5 flex-none text-ink-2" />
      )}
      <div className="min-w-0 grow">
        <div className="truncate font-mono text-[12.5px] font-medium">
          {f.path.split("/").pop()} <span className="font-sans font-normal text-ink-3">· {bytes(f.bytes)}</span>
        </div>
        {f.note ? <p className="text-[12.5px] text-ink-2">{f.note}</p> : null}
      </div>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`View ${f.path}`} onClick={() => setViewing(f.path)}>
        <Eye size={15} />
      </button>
      <a className="icon-btn icon-btn-sm" aria-label={`Download ${f.path}`} href={`/api/builds/${b.id}/files/${f.path}?download=1`}>
        <DownloadSimple size={15} />
      </a>
    </li>
  );

  return (
    <section>
      <SectionTitle title="Download" hint="what your firmware needs, or everything with the proof" />
      {files.isPending ? (
        <div className="flex items-center gap-2 text-ink-2">
          <span className="spinner" /> Reading the package…
        </div>
      ) : files.error ? (
        <Callout level="block" title="The package could not be read">
          {errorMessage(files.error)}
        </Callout>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="panel flex min-w-0 flex-col gap-4 border-ink/70 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-[8px] bg-ink text-on-ink">
                <FileCode size={20} />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold">Essentials</h3>
                <p className="text-[13px] text-ink-2">The header and the C file. Add both to your firmware project.</p>
              </div>
            </div>
            <ul className="divide-y divide-line rounded-[8px] border border-line">{essentials.map(row)}</ul>
            <div>
              <div className="mb-1.5 text-[12.5px] text-ink-3">Call it like this</div>
              <pre className="code-block">{usageSnippet(ws.data.project.spec?.task, ws.data.training?.sample_rate_hz)}</pre>
            </div>
            <p className="text-[12.5px] text-ink-3">
              Compile with <code className="rounded bg-surface-2 px-1">-O2 -ffp-contract=off</code> so results match the tested build. No
              heap, no maths library.
            </p>
          </div>

          <div className="panel flex min-w-0 flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-[8px] bg-surface-2">
                <Package size={20} />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold">Full package</h3>
                <p className="text-[13px] text-ink-2">
                  {list.length} files, {bytes(total)}, signed. Includes the proof you can re-run.
                </p>
              </div>
            </div>
            <div className="max-h-[340px] overflow-auto rounded-[8px] border border-line">
              {[...folders.entries()].map(([dir, group]) => (
                <div key={dir}>
                  <div className="sticky top-0 flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-ink-2">
                    <Folder size={13} /> {dir}
                  </div>
                  <ul className="divide-y divide-line">{group.map(row)}</ul>
                </div>
              ))}
            </div>
            <a className="btn self-start" href={`/api/builds/${b.id}/download`}>
              <DownloadSimple size={16} weight="bold" /> Download the full package (.zip)
            </a>
            <p className="text-[12.5px] text-ink-3">
              Check it any time with <code className="rounded bg-surface-2 px-1">tinyml verify &lt;zip&gt;</code>: it confirms the signature
              and every file's SHA-256.
            </p>
          </div>
        </div>
      )}
      <FileViewer buildId={b.id} path={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

function FileViewer({ buildId, path, onClose }: { buildId: string; path: string | null; onClose: () => void }) {
  const file = useQuery({
    queryKey: ["file", buildId, path],
    queryFn: () => api<string>(`/builds/${buildId}/files/${path}`),
    enabled: !!path,
  });
  const text = typeof file.data === "string" ? file.data : JSON.stringify(file.data, null, 2);
  return (
    <Modal open={!!path} onOpenChange={(o) => !o && onClose()} title={<span className="font-mono text-[14px]">{path}</span>} wide>
      <div className="mb-3 flex gap-2">
        <Button
          size="sm"
          icon={Copy}
          disabled={!file.data}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast("Copied");
            } catch {
              toast("Copying is not available in this browser", "error");
            }
          }}
        >
          Copy
        </Button>
        <a className="btn btn-sm" href={`/api/builds/${buildId}/files/${path}?download=1`}>
          <DownloadSimple size={14} /> Download
        </a>
      </div>
      {file.isPending ? (
        <div className="flex items-center gap-2 text-ink-2">
          <span className="spinner" /> Loading the file…
        </div>
      ) : file.error ? (
        <Callout level="block">{errorMessage(file.error)}</Callout>
      ) : (
        <pre className="code-block max-h-[60vh]">{text}</pre>
      )}
    </Modal>
  );
}

function Report({ buildId }: { buildId: string }) {
  const [open, setOpen] = useState(false);
  const report = useQuery({ queryKey: ["report", buildId], queryFn: () => api<string>(`/builds/${buildId}/report`), enabled: open });
  return (
    <Disclosure title="The report inside the package" onOpen={() => setOpen(true)}>
      {report.isPending ? (
        <div className="flex items-center gap-2 text-ink-2">
          <span className="spinner" /> Loading the report…
        </div>
      ) : report.error ? (
        <Callout level="block">{errorMessage(report.error)}</Callout>
      ) : (
        <div className="max-w-[78ch]">
          <Markdown text={String(report.data)} />
        </div>
      )}
    </Disclosure>
  );
}

function EarlierBuilds({ builds }: { builds: BuildRow[] }) {
  const ws = useWorkspace();
  if (!builds.length) return null;
  return (
    <Disclosure title={`Earlier builds (${builds.length})`}>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Chip</th>
              <th>Version</th>
              <th>Built</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {builds.map((x) => (
              <tr key={x.id}>
                <td>{ws.chipName(x.chip_id)}</td>
                <td className="font-mono">v{x.version}</td>
                <td className="text-ink-3">{relativeTime(x.created_at)}</td>
                <td>{x.passed ? <Status tone="ok">Verified</Status> : <Status tone="block">Blocked</Status>}</td>
                <td className="text-right">
                  {x.package_path ? (
                    <a className="btn btn-sm btn-ghost" href={`/api/builds/${x.id}/download`}>
                      <DownloadSimple size={14} /> Download
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}
