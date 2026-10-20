import { ArrowRight, PencilSimple } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../api";
import { ActionBar, Button, Confirm, PageHeader, SectionTitle, Status } from "../components/ui";
import { keys, stepPath, useAction, usePanel, useWorkspace, viewPath } from "../data";
import { CONNECTIVITY, PRIORITY, cap, num } from "../format";
import { Reveal } from "../motion";
import type { Project } from "../types";

const DECISION_FIELD: Record<string, string> = {
  recipe: "Use case",
  task: "Task",
  connectivity: "Radio",
  power: "Power",
  priority: "Priority",
};

export function Spec() {
  const ws = useWorkspace();
  const panel = usePanel();
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const action = useAction();
  const project = ws.data.project;
  const spec = project.spec!;
  const recipe = ws.recipes.find((r) => r.id === spec.recipe);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(project.description);
  const [confirm, setConfirm] = useState(false);
  const unconfirmed = new Set(ws.data.pending_decisions.map((p) => p.decision_type));
  const target = spec.task === "anomaly" ? recipe?.targets.anomaly : undefined;

  const fork = async () => {
    const res = await api<{ project: Project }>("/projects", { json: { description: text.trim() } });
    await client.invalidateQueries({ queryKey: keys.projects });
    navigate(viewPath(res.project.id, "dashboard"));
  };

  const rows: [string, string, string][] = [
    ["recipe", "Use case", recipe?.title ?? spec.recipe],
    ["task", "Task", spec.task === "anomaly" ? "Anomaly detection" : "Classification"],
    ["connectivity", "Radio", CONNECTIVITY[spec.connectivity]],
    ["power", "Power", spec.power === "battery" ? "Battery" : "Mains"],
    ["priority", "Ranking priority", PRIORITY[spec.priority]],
    ["budget", "Budget per chip", spec.budget_usd_per_unit ? `$${num(spec.budget_usd_per_unit, 2)}` : "No limit"],
    ["latency", "Latency limit", `${num(spec.max_latency_ms)} ms`],
    ["seed", "Seed", String(spec.seed)],
  ];

  return (
    <div>
      <PageHeader title="Brief" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Reveal className="panel min-w-0">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Objective</h2>
            {!editing ? (
              <Button size="sm" variant="ghost" icon={PencilSimple} className="ml-auto" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </div>
          {editing ? (
            <div className="p-3">
              <label htmlFor="objective" className="sr-only">
                Objective
              </label>
              <textarea
                id="objective"
                autoFocus
                className="field-input min-h-[140px] resize-y text-[14px] leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="grow text-[12px] text-ink-3">
                  Saving a changed objective creates a new workspace; this one stays as it is.
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setText(project.description);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!text.trim() || text.trim() === project.description.trim()}
                  onClick={() => setConfirm(true)}
                >
                  Save as new workspace
                </Button>
              </div>
            </div>
          ) : (
            <p className="px-4 py-3 text-[14px] leading-relaxed">{project.description}</p>
          )}
        </Reveal>

        <Reveal order={1} className="panel min-w-0">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Derived specification</h2>
            {unconfirmed.size ? <Status tone="warn">{unconfirmed.size} unconfirmed</Status> : <Status tone="ok">Confirmed</Status>}
          </div>
          <dl className="spec-list px-4 py-1 text-[13px]">
            {rows.map(([key, label, value]) => (
              <div key={key} className="contents">
                <dt>{label}</dt>
                <dd className="flex items-center gap-2">
                  {value}
                  {unconfirmed.has(key) ? (
                    <button type="button" className="status status-warn hover:underline" onClick={() => panel.setOpen(true)}>
                      unconfirmed
                    </button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>

      {recipe ? (
        <Reveal order={2} className="mt-6">
          <SectionTitle title="Acceptance targets" hint={`from the ${recipe.title.toLowerCase()} recipe`} />
          <dl className="panel spec-list px-4 py-1 text-[13px]">
            {spec.task === "anomaly" && target ? (
              <>
                <dt>Faults caught</dt>
                <dd>at least {Math.round(target.detection_rate * 100)}%</dd>
                <dt>False alarms</dt>
                <dd>at most {Math.round(target.false_alarm_rate * 100)}%</dd>
              </>
            ) : (
              <>
                <dt>Events recognised</dt>
                <dd>at least {Math.round(recipe.targets.classification.accuracy * 100)}% on average</dd>
              </>
            )}
            <dt>Recipe</dt>
            <dd className="!font-sans">{cap(recipe.summary)}</dd>
          </dl>
        </Reveal>
      ) : null}

      {unconfirmed.size ? (
        <p className="mt-4 text-[12.5px] text-ink-3">
          Unconfirmed: {[...unconfirmed].map((k) => DECISION_FIELD[k] ?? k.replaceAll("_", " ")).join(", ")}. Confirm them in the assistant
          panel.
        </p>
      ) : null}

      <ActionBar note="Next: Targets.">
        <Link href={stepPath(ws.pid, "target")} className="btn btn-primary btn-lg">
          Continue to Targets
          <ArrowRight size={15} weight="bold" className="nudge" />
        </Link>
      </ActionBar>

      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Create a new workspace?"
        body="A new objective needs a new specification, so it opens as a new workspace. This one keeps its data, models and packages."
        confirmLabel="Create workspace"
        onConfirm={() => action.run(fork)}
      />
    </div>
  );
}
