import * as Switch from "@radix-ui/react-switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { toast } from "../components/Toast";
import { Callout, PageHeader, Segmented, cx } from "../components/ui";
import { keys, useCatalog, useSettings } from "../data";
import { local } from "../format";
import { setTheme, type Theme } from "../theme";
import type { Doctor, Settings } from "../types";

export function SettingsPage() {
  const client = useQueryClient();
  const settings = useSettings();
  const catalog = useCatalog();
  const doctor = useQuery({ queryKey: ["doctor"], queryFn: () => api<Doctor>("/doctor"), staleTime: 60_000 });
  const [theme, setThemeState] = useState<Theme>(local.get<Theme>("tinyml.theme", "dark"));

  const update = async (patch: Partial<{ provider: string; review_gates: boolean }>, message: string) => {
    try {
      const next = await api<Settings>("/settings", { method: "PUT", json: patch });
      client.setQueryData(keys.settings, next);
      await client.invalidateQueries({ queryKey: ["project"] });
      toast(message);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  if (settings.isPending) {
    return (
      <div className="flex items-center gap-2 text-ink-2">
        <span className="spinner" /> Loading settings…
      </div>
    );
  }
  if (settings.error) {
    return (
      <Callout level="block" title="Settings could not be loaded">
        {errorMessage(settings.error)}
      </Callout>
    );
  }

  const st = settings.data;
  const found = doctor.data?.assistant?.claude_code_found;
  const providers = [
    { id: "off", title: "Rules only, no AI", text: "Unsure points become questions for you. Everything works this way." },
    {
      id: "claude_code",
      title: "Claude Code",
      text: doctor.isPending
        ? "Checking whether Claude Code is installed…"
        : found
          ? `Found ${doctor.data?.assistant?.claude_version}. Answers on this computer with your own login.`
          : "Not found on this computer. Install Claude Code to use it.",
    },
    { id: "claude_chat", title: "Claude chat", text: "Shows a ready prompt that you paste into Claude chat yourself." },
  ];
  const testable = catalog.data?.chips.filter((c) => c.testable).length ?? 0;

  return (
    <div className="max-w-[760px]">
      <PageHeader title="Settings" lede="These apply to every workspace." />

      <section className="border-t border-line py-6">
        <h2 className="text-[15px] font-semibold">Assistant</h2>
        <p className="mt-1 text-ink-2">
          Rules decide first and ask the assistant only when they are unsure. You have the final say. The assistant sees summaries, never
          your sensor data.
        </p>
        <div role="radiogroup" aria-label="Assistant" className="mt-4 divide-y divide-line rounded-[10px] border border-line bg-surface">
          {providers.map((p) => {
            const on = st.assistant.provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && update({ provider: p.id }, `Assistant set to ${p.title}`)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left first:rounded-t-[10px] last:rounded-b-[10px] hover:bg-surface-2"
              >
                <span
                  className={cx(
                    "mt-1 grid h-4 w-4 flex-none place-items-center rounded-full border-2",
                    on ? "border-ink" : "border-line-strong",
                  )}
                  aria-hidden
                >
                  {on ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
                </span>
                <span>
                  <span className="block font-medium">{p.title}</span>
                  <span className="block text-[13px] text-ink-2">{p.text}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex items-start gap-6 border-t border-line py-6">
        <div className="grow">
          <h2 id="gates-title" className="text-[15px] font-semibold">
            Review gates
          </h2>
          <p className="mt-1 text-ink-2">
            When on, training waits until you approve the data checks, and comparing chips or building waits until you approve the model.
            Review cards appear in the assistant panel after every stage either way.
          </p>
        </div>
        <Switch.Root
          aria-labelledby="gates-title"
          checked={st.review_gates}
          onCheckedChange={(v) => update({ review_gates: v }, v ? "Each stage now waits for your approval" : "Review gates are off")}
          className="relative mt-1 h-6 w-11 flex-none rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-ink data-[state=checked]:bg-ink"
        >
          <Switch.Thumb className="block h-[18px] w-[18px] translate-x-[2px] rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-ink" />
        </Switch.Root>
      </section>

      <section className="border-t border-line py-6">
        <h2 className="mb-3 text-[15px] font-semibold">Appearance</h2>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(v) => {
            setTheme(v);
            setThemeState(v);
          }}
          options={[
            ["system", "Match the system"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
        />
      </section>

      <section className="border-t border-line py-6">
        <h2 className="text-[15px] font-semibold">Chip catalog</h2>
        {catalog.data ? (
          <>
            <p className="mt-1">
              {catalog.data.chips.length} chips from {catalog.data.vendors.length} makers, version{" "}
              <span className="font-mono">{catalog.data.info.version}</span>. {catalog.data.info.source}.
            </p>
            <p className="mt-1 text-ink-2">
              {testable} of them can be built and tested on this computer. Prices and currents are estimates; memory, cores and clocks are
              datasheet values. Run <code className="rounded bg-surface-2 px-1">tinyml doctor</code> to see what is missing for the rest.
            </p>
          </>
        ) : (
          <p className="mt-1 text-ink-2">Loading the catalog…</p>
        )}
      </section>
    </div>
  );
}
