import { ListChecks } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api";
import { toast } from "../components/Toast";
import { Callout, Empty, PageHeader, SectionTitle, Status, cx } from "../components/ui";
import { historyTabs, useOptionalWorkspace } from "../data";
import { pct } from "../format";
import type { Decision, LearnedRule } from "../types";

const SOURCE: Record<string, string> = {
  rules: "Rules",
  learned_rule: "Learned rule",
  claude_code: "Claude Code",
  claude_chat: "Claude chat",
  user: "You",
  default: "Default",
};

export function Decisions({ pid: given = null, embedded = false }: { pid?: string | null; embedded?: boolean }) {
  const ws = useOptionalWorkspace();
  const pid = embedded && ws ? ws.pid : given;
  const client = useQueryClient();
  const rows = useQuery({
    queryKey: ["decisions", pid],
    queryFn: () => api<Decision[]>(`/decisions${pid ? `?project_id=${pid}` : ""}`),
  });
  const rules = useQuery({ queryKey: ["learned-rules"], queryFn: () => api<LearnedRule[]>("/learned-rules") });

  const choose = async (d: Decision, choice: string) => {
    try {
      await api(`/decisions/${d.id}`, { method: "PATCH", json: { choice } });
      toast("Recorded");
      await client.invalidateQueries({ queryKey: ["decisions"] });
      await client.invalidateQueries({ queryKey: ["project"] });
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div>
      <PageHeader
        tabs={embedded && ws ? historyTabs(ws.pid, "decisions", ws.data.jobs.length) : undefined}
        title={embedded ? "Decision log" : "Decisions"}
        lede="Choices made by the rules, the assistant or you. A correction you repeat three times becomes a rule."
      />

      {rows.isPending ? (
        <div className="flex items-center gap-2 text-ink-2">
          <span className="spinner" /> Loading decisions…
        </div>
      ) : rows.error ? (
        <Callout level="block" title="The decision log could not be loaded">
          {errorMessage(rows.error)}
        </Callout>
      ) : !rows.data.length ? (
        <Empty icon={ListChecks} title="No decisions yet">
          Decisions appear after the data is checked.
        </Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th>About</th>
                <th>Answer</th>
                <th className="num">Confidence</th>
                <th>Decided by</th>
                <th>Final choice</th>
                <th>Build</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.id} className={cx(!r.final_choice && "bg-warn-wash/60")}>
                  <td>{r.decision_type.replaceAll("_", " ")}</td>
                  <td className="font-mono text-[12px]">{r.decision_key}</td>
                  <td>{r.answer}</td>
                  <td className="num">{pct(r.confidence)}</td>
                  <td>{SOURCE[r.source] ?? r.source}</td>
                  <td>
                    <select
                      aria-label={`Final choice for ${r.decision_type.replaceAll("_", " ")} ${r.decision_key}`}
                      className="field-input !min-h-8 !w-auto !py-1 text-[13px]"
                      value={r.final_choice ?? ""}
                      onChange={(e) => e.target.value && choose(r, e.target.value)}
                    >
                      {!r.final_choice ? <option value="">Choose…</option> : null}
                      {r.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {r.build_passed === null ? (
                      <span className="text-ink-3">–</span>
                    ) : r.build_passed ? (
                      <Status tone="ok">Passed</Status>
                    ) : (
                      <Status tone="block">Failed</Status>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8">
        <SectionTitle title="Learned rules" hint="corrections that became fixed rules" />
        {rules.data?.length ? (
          <ul className="panel divide-y divide-line">
            {rules.data.map((r) => (
              <li key={`${r.decision_type}-${r.decision_key}`} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-[13.5px]">
                <span>{r.decision_type.replaceAll("_", " ")}</span>
                <span className="font-mono text-[12.5px]">{r.decision_key}</span>
                <span className="font-medium">always {r.choice}</span>
                <span className="ml-auto text-ink-3">{r.support} corrections</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">None yet. Correct the same decision three times and it becomes a rule here.</p>
        )}
      </section>
    </div>
  );
}
