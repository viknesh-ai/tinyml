import { ArrowRight, CaretDown, Cpu } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../api";
import { toast } from "../components/Toast";
import { ActionBar, Button, Hint, PageHeader, Prov, Segmented, cx } from "../components/ui";
import { backTo, useAction, useWorkspace, stepPath } from "../data";
import { CONNECTIVITY, PRIORITY, RADIO, cap, kb, num, plural } from "../format";
import { DURATION, EASE_OUT, SPRING } from "../motion";
import type { Chip, Spec } from "../types";

type Form = Pick<Spec, "vendor" | "connectivity" | "power" | "budget_usd_per_unit" | "priority" | "max_latency_ms"> & {
  chip_ids: string[];
};

export function Chips() {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const spec = ws.data.project.spec!;
  const { chips, vendors } = ws.catalog;
  const [form, setForm] = useState<Form>({
    vendor: spec.vendor,
    connectivity: spec.connectivity,
    power: spec.power,
    budget_usd_per_unit: spec.budget_usd_per_unit,
    priority: spec.priority,
    max_latency_ms: spec.max_latency_ms,
    chip_ids: [...ws.data.chip_ids],
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const save = useAction();

  const { connectivity, power, budget_usd_per_unit, priority, max_latency_ms } = form;
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        // The maker filter is applied by the list itself, so ask only about the requirements.
        const body = { spec: { ...spec, vendor: "any", connectivity, power, budget_usd_per_unit, priority, max_latency_ms } };
        setReasons(await api<Record<string, string>>("/chips/check", { json: body }));
      } catch {
        /* keep the last answer; the save will report a real problem */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [spec, connectivity, power, budget_usd_per_unit, priority, max_latency_ms]);

  const vendorChips = useMemo(() => chips.filter((c) => form.vendor === "any" || c.vendor === form.vendor), [chips, form.vendor]);
  const considered = form.chip_ids.length ? chips.filter((c) => form.chip_ids.includes(c.id)) : vendorChips;
  const out = considered.filter((c) => reasons[c.id]);
  const untestable = considered.filter((c) => !reasons[c.id] && !c.testable);
  const tested = considered.length - out.length - untestable.length;

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const pickVendor = (id: string) =>
    setForm((f) => ({
      ...f,
      vendor: id,
      chip_ids: f.chip_ids.filter((c) => id === "any" || chips.find((x) => x.id === c)?.vendor === id),
    }));
  const toggle = (id: string) =>
    setForm((f) => ({ ...f, chip_ids: f.chip_ids.includes(id) ? f.chip_ids.filter((c) => c !== id) : [...f.chip_ids, id] }));

  const submit = () =>
    save.run(async () => {
      const { chip_ids: chipIds, ...changes } = form;
      await api(`/projects/${ws.pid}/spec`, { method: "PATCH", json: changes });
      await api(`/projects/${ws.pid}/chips`, { method: "PUT", json: { chip_ids: chipIds } });
      await ws.refresh();
      toast("Chips and requirements saved");
      navigate(stepPath(ws.pid, "data"));
    });

  const one = form.chip_ids.length === 1 ? chips.find((c) => c.id === form.chip_ids[0]) : null;
  const summary = one ? (
    <>
      <span className="font-medium text-ink">One chip chosen: {one.name}.</span> Comparing is skipped and the final build runs for this
      chip.
      {reasons[one.id] ? ` Note: it does not meet your requirements (${reasons[one.id]}).` : ""}
    </>
  ) : (
    <>
      <motion.span
        key={tested}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="inline-block font-medium text-ink"
      >
        {plural(tested, "chip")} will be built and tested
      </motion.span>
      {out.length ? ` · ${out.length} left out by your requirements` : ""}
      {untestable.length ? ` · ${untestable.length} can't be tested on this computer` : ""}
    </>
  );

  return (
    <div>
      <PageHeader title="Targets" lede="The chips to build for and your limits for them." />

      <section className="panel mb-6">
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-4 py-3 text-left hover:bg-surface-2"
        >
          <span className="font-semibold">Requirements</span>
          <span className="flex min-w-0 grow flex-wrap gap-1.5 text-[12.5px]">
            {[
              CONNECTIVITY[form.connectivity],
              form.power === "battery" ? "Battery" : "Plugged in",
              `${PRIORITY[form.priority]} first`,
              form.budget_usd_per_unit ? `Up to $${num(form.budget_usd_per_unit, 2)}` : "No budget limit",
              `Answer within ${num(form.max_latency_ms)} ms`,
            ].map((t) => (
              <span key={t} className="rounded-[4px] bg-surface-2 px-2 py-0.5 text-ink-2">
                {t}
              </span>
            ))}
          </span>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium">
            {editing ? "Done" : "Change"}
            <motion.span animate={{ rotate: editing ? 180 : 0 }} transition={SPRING} className="inline-flex">
              <CaretDown size={12} weight="bold" />
            </motion.span>
          </span>
        </button>
        <AnimatePresence initial={false}>
          {editing ? (
            <motion.div
              key="editor"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: DURATION.slow, ease: EASE_OUT }, opacity: { duration: DURATION.base } }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 border-t border-line px-4 py-4 md:grid-cols-2">
                <Field label="How it talks" help="Wi-Fi and Bluetooth must be built into the chip. Cellular assumes an external modem.">
                  <Segmented
                    label="How it talks"
                    value={form.connectivity}
                    onChange={(v) => set({ connectivity: v })}
                    options={[
                      ["wifi", "Wi-Fi"],
                      ["ble", "Bluetooth LE"],
                      ["cellular", "Cellular"],
                      ["none", "No radio"],
                      ["any", "Not decided"],
                    ]}
                  />
                </Field>
                <Field label="Power">
                  <Segmented
                    label="Power"
                    value={form.power}
                    onChange={(v) => set({ power: v })}
                    options={[
                      ["battery", "Battery"],
                      ["plugged", "Plugged in"],
                    ]}
                  />
                </Field>
                <Field label="What matters most" help="Decides how the tested chips are ranked.">
                  <Segmented
                    label="What matters most"
                    value={form.priority}
                    onChange={(v) => set({ priority: v })}
                    options={[
                      ["battery", "Battery life"],
                      ["cost", "Low cost"],
                      ["speed", "Speed"],
                    ]}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Budget per chip (USD)" htmlFor="budget">
                    <input
                      id="budget"
                      type="number"
                      step="0.1"
                      min="0"
                      className="field-input"
                      placeholder="No limit"
                      value={form.budget_usd_per_unit ?? ""}
                      onChange={(e) => set({ budget_usd_per_unit: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Answer within (ms)" htmlFor="latency">
                    <input
                      id="latency"
                      type="number"
                      min="1"
                      className="field-input"
                      value={form.max_latency_ms}
                      onChange={(e) => set({ max_latency_ms: Number(e.target.value) || 1000 })}
                    />
                  </Field>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <section aria-labelledby="maker-title">
          <h2 id="maker-title" className="mb-2 text-[15px] font-semibold">
            Chip maker
          </h2>
          <div role="radiogroup" aria-labelledby="maker-title" className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            <MakerOption
              checked={form.vendor === "any"}
              onSelect={() => pickVendor("any")}
              name="Any maker"
              count={chips.length}
              summary={`Neutral comparison across all ${vendors.length} makers.`}
            />
            {vendors.map((v) => (
              <MakerOption
                key={v.id}
                checked={form.vendor === v.id}
                onSelect={() => pickVendor(v.id)}
                name={v.name}
                count={v.chips}
                summary={v.summary}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="chips-title" className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="chips-title" className="text-[15px] font-semibold">
              {form.vendor === "any" ? "Chips" : `${ws.vendorName(form.vendor)} chips`}
            </h2>
            <span className="text-[13px] text-ink-3">
              {form.vendor === "any"
                ? "pick one maker to choose exact chips"
                : form.chip_ids.length
                  ? `${form.chip_ids.length} of ${vendorChips.length} ticked`
                  : `optional · none ticked means all ${vendorChips.length} are compared`}
            </span>
            {form.vendor !== "any" ? (
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => set({ chip_ids: vendorChips.map((c) => c.id) })}>
                  Tick all
                </Button>
                <Button size="sm" variant="ghost" disabled={!form.chip_ids.length} onClick={() => set({ chip_ids: [] })}>
                  Clear
                </Button>
              </span>
            ) : null}
          </div>

          {form.vendor === "any" ? (
            <AnyMaker chips={chips} reasons={reasons} vendorName={ws.vendorName} />
          ) : (
            <motion.ul
              key={form.vendor}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              className="panel divide-y divide-line overflow-hidden"
            >
              {vendorChips.map((c) => (
                <ChipRow key={c.id} chip={c} checked={form.chip_ids.includes(c.id)} reason={reasons[c.id]} onToggle={() => toggle(c.id)} />
              ))}
            </motion.ul>
          )}
        </section>
      </div>

      <ActionBar back={backTo(ws.pid, "target")} note={summary}>
        <Button variant="primary" size="lg" busy={save.busy} onClick={submit}>
          Save and continue
          <ArrowRight size={15} weight="bold" className="nudge" />
        </Button>
      </ActionBar>
    </div>
  );
}

function Field({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {help ? <p className="mt-1.5 text-[12.5px] text-ink-3">{help}</p> : null}
    </div>
  );
}

function MakerOption({
  checked,
  onSelect,
  name,
  count,
  summary,
}: {
  checked: boolean;
  onSelect: () => void;
  name: string;
  count: number;
  summary: string;
}) {
  return (
    <Hint label={summary}>
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className={cx(
          "relative flex min-h-[38px] items-center gap-2 rounded-[6px] border px-3 text-left text-[13.5px] lg:border-transparent",
          checked ? "border-signal font-medium text-signal-text" : "border-line hover:bg-surface-2",
        )}
      >
        {checked ? (
          <motion.span
            layoutId="maker-selected"
            transition={SPRING}
            className="absolute inset-0 rounded-[5px] bg-signal-wash shadow-[inset_0_0_0_1px_var(--signal)]"
            aria-hidden
          />
        ) : null}
        <span className="relative grow">{name}</span>
        <span className={cx("relative font-mono text-[12px]", checked ? "text-signal-text" : "text-ink-3")}>{count}</span>
      </button>
    </Hint>
  );
}

function ChipRow({ chip, checked, reason, onToggle }: { chip: Chip; checked: boolean; reason?: string; onToggle: () => void }) {
  const radios = chip.radios.length ? chip.radios.map((r) => RADIO[r] ?? r).join(", ") : "No radio";
  return (
    <li>
      <label
        className={cx(
          "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-200 hover:bg-surface-2",
          checked && "bg-signal-wash/50",
        )}
      >
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 h-4 w-4 accent-[var(--ink)]" aria-label={chip.name} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{chip.family}</span>
            <span className="font-mono text-[12px] text-ink-3">{chip.part_number}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-ink-2">{chip.notes}</p>
          <p className="mt-1 font-mono text-[12px] text-ink-3">
            {num(chip.clock_mhz)} MHz · {chip.has_fpu ? "FPU" : "no FPU"} · {kb(chip.ram_kb)} RAM · {kb(chip.flash_kb)} flash · {radios}
          </p>
          {reason || !chip.testable ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {reason ? <span className="status status-warn">{cap(reason)}</span> : null}
              {!chip.testable ? (
                <Hint label={chip.not_testable_reason ?? "Its build tools are not installed on this computer."}>
                  <span tabIndex={0} className="status">
                    Can't test on this computer
                  </span>
                </Hint>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="text-right font-mono text-[13px]">
          ${chip.price_usd.toFixed(2)}
          <div>
            <Prov tag="estimated" />
          </div>
        </div>
      </label>
    </li>
  );
}

function AnyMaker({ chips, reasons, vendorName }: { chips: Chip[]; reasons: Record<string, string>; vendorName: (id: string) => string }) {
  const byVendor = new Map<string, Chip[]>();
  chips.forEach((c) => byVendor.set(c.vendor, [...(byVendor.get(c.vendor) ?? []), c]));
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3 text-[13.5px] text-ink-2">
        <Cpu size={18} className="mt-0.5 flex-none text-ink-2" />
        <p>Every chip that meets your limits is built and ranked. Pick a maker to choose exact chips.</p>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Maker</th>
            <th className="num">Chips</th>
            <th className="num">Meet your requirements</th>
            <th className="num">Testable here</th>
          </tr>
        </thead>
        <tbody>
          {[...byVendor.entries()].map(([v, list]) => (
            <tr key={v}>
              <td>{vendorName(v)}</td>
              <td className="num">{list.length}</td>
              <td className="num">{list.filter((c) => !reasons[c.id]).length}</td>
              <td className="num">{list.filter((c) => c.testable).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
