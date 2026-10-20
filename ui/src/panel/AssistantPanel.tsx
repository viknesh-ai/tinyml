import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUp, Copy, Trash, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { api, errorMessage } from "../api";
import { Markdown } from "../components/Markdown";
import { toast } from "../components/Toast";
import { cx } from "../components/ui";
import { STEP_STAGE, useAction, useOptionalWorkspace, usePanel, useSettings, stepPath } from "../data";
import { local } from "../format";
import { DURATION, EASE_OUT, SPRING } from "../motion";
import { useMediaQuery } from "../theme";
import type { AskResponse, Decision } from "../types";
import { ReviewCard } from "./ReviewCard";

const MODE: Record<string, string> = { off: "Rules only", claude_code: "Claude Code", claude_chat: "Claude chat" };

interface Message {
  who: "me" | "bot";
  text: string;
  source?: string;
  prompt?: string;
}

export function AssistantPanel() {
  const panel = usePanel();
  const wide = useMediaQuery("(min-width: 1280px)");
  if (wide) {
    if (!panel.open) return null;
    return (
      <aside
        id="assistant"
        aria-label="Assistant and review"
        className="flex w-[clamp(340px,30vw,420px)] flex-none flex-col border-l border-line bg-surface"
      >
        <motion.div
          className="flex min-h-0 grow flex-col"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        >
          <PanelBody onClose={() => panel.setOpen(false)} />
        </motion.div>
      </aside>
    );
  }
  return (
    <Dialog.Root open={panel.open} onOpenChange={panel.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-overlay fixed inset-0 z-40 bg-[var(--overlay)]" />
        <Dialog.Content
          id="assistant"
          aria-describedby={undefined}
          className="anim-drawer fixed inset-y-0 right-0 z-50 flex w-[min(440px,100vw)] flex-col border-l border-line bg-surface shadow-float"
        >
          <Dialog.Title className="sr-only">Assistant and review</Dialog.Title>
          <PanelBody onClose={() => panel.setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2 first:mt-0">
      <h2 className="text-[12.5px] font-semibold text-ink-2">{children}</h2>
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

function PanelBody({ onClose }: { onClose: () => void }) {
  const ws = useOptionalWorkspace();
  const settings = useSettings();
  const panel = usePanel();
  const provider = settings.data?.assistant.provider ?? "off";
  const scroller = useRef<HTMLDivElement>(null);
  const [thread, setThread] = useState<Message[]>(() => (ws ? local.get(`tinyml.chat.${ws.pid}`, []) : []));
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setThread(ws ? local.get(`tinyml.chat.${ws.pid}`, []) : []);
  }, [ws?.pid]);

  const save = (next: Message[]) => {
    setThread(next);
    if (ws) local.set(`tinyml.chat.${ws.pid}`, next.slice(-40));
  };

  const ask = async (question: string) => {
    if (!ws || busy || !question.trim()) return;
    const asked = [...thread, { who: "me" as const, text: question.trim() }];
    save(asked);
    setDraft("");
    setBusy(true);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
    let reply: Message;
    try {
      const latest = ws.data.builds.find((b) => b.package_path);
      const res = await api<AskResponse>(`/projects/${ws.pid}/ask`, {
        json: { question, stage: ws.step ?? ws.view, build_id: ws.step === "build" && latest ? latest.id : null },
      });
      if (res.answer) reply = { who: "bot", text: res.answer, source: res.source };
      else if (res.source === "off") reply = { who: "bot", text: res.message ?? "", prompt: res.prompt, source: "off" };
      else if (res.source === "claude_chat")
        reply = {
          who: "bot",
          text: "Copy this prompt into Claude chat. It holds only summaries of this workspace, never your sensor data.",
          prompt: res.prompt,
          source: "claude_chat",
        };
      else
        reply = {
          who: "bot",
          text: `Claude Code was not available (${res.error}). You can paste this prompt into Claude chat instead.`,
          prompt: res.prompt,
          source: "unavailable",
        };
    } catch (err) {
      reply = { who: "bot", text: errorMessage(err), source: "error" };
    }
    save([...asked, reply]);
    setBusy(false);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  };

  const d = ws?.data;
  const cards = d?.reviews ?? [];
  const stepStage = ws?.step ? STEP_STAGE[ws.step] : undefined;
  const focusStage =
    panel.focus ??
    (cards.some((c) => c.stage === stepStage) ? stepStage : (cards.find((c) => c.status !== "approved") ?? cards[cards.length - 1])?.stage);
  const focusCard = cards.find((c) => c.stage === focusStage);
  const otherCards = cards.filter((c) => c.stage !== focusStage);
  const waitingCards = cards.filter((c) => c.status !== "approved").length;

  return (
    <>
      <div className="flex h-12 flex-none items-center gap-2 border-b border-line px-4">
        <h2 className="grow text-[14px] font-semibold">Assistant</h2>
        <Link href="/settings" className="status hover:underline" title="Change the assistant in Settings">
          {MODE[provider] ?? provider}
        </Link>
        <button type="button" className="icon-btn -mr-2" aria-label="Close the assistant panel" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div ref={scroller} className="min-h-0 grow overflow-y-auto px-4 py-4 [overflow-anchor:none]">
        {!ws ? (
          <div className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-[13.5px] text-ink-2">
            <p className="font-medium text-ink">Review for each stage</p>
            <p className="mt-1.5">Open a workspace to see its reviews.</p>
          </div>
        ) : (
          <>
            {focusCard ? (
              <>
                <SectionLabel
                  right={
                    <span className="text-[12px] text-ink-3">
                      {waitingCards ? `${waitingCards} waiting` : "All approved"} · gates {d?.review_gates ? "on" : "off"}
                    </span>
                  }
                >
                  Review
                </SectionLabel>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={focusCard.stage}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4, transition: { duration: DURATION.fast } }}
                    transition={{ duration: DURATION.base, ease: EASE_OUT }}
                  >
                    <ReviewCard card={focusCard} onAsk={ask} />
                  </motion.div>
                </AnimatePresence>
                {otherCards.length ? (
                  <ul className="mt-2 divide-y divide-line rounded-[10px] border border-line">
                    {otherCards.map((c) => (
                      <motion.li key={c.stage} layout="position" transition={SPRING}>
                        <button
                          type="button"
                          onClick={() => panel.setFocus(c.stage)}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] hover:bg-surface-2"
                        >
                          <span
                            className={cx("h-2 w-2 flex-none rounded-full", c.status === "approved" ? "bg-ok" : "bg-warn")}
                            aria-hidden
                          />
                          <span className="grow font-medium">{c.title}</span>
                          <span className="text-[12px] text-ink-3">
                            {c.status === "approved" ? "Approved" : c.status === "changes_requested" ? "Changes requested" : "Needs review"}
                          </span>
                        </button>
                      </motion.li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {d && d.pending_decisions.length ? (
              <>
                <SectionLabel right={<span className="text-[12px] text-ink-3">{d.pending_decisions.length} open</span>}>
                  Unconfirmed settings
                </SectionLabel>
                <div className="panel divide-y divide-line">
                  {d.pending_decisions.slice(0, 5).map((p) => (
                    <DecisionItem key={p.id} decision={p} />
                  ))}
                </div>
              </>
            ) : null}

            <SectionLabel
              right={
                thread.length ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"
                    onClick={() => save([])}
                  >
                    <Trash size={12} /> Clear
                  </button>
                ) : null
              }
            >
              Ask
            </SectionLabel>
            {thread.length ? (
              <div className="space-y-3" aria-live="polite">
                <AnimatePresence initial={false}>
                  {thread.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={SPRING}
                      style={{ transformOrigin: m.who === "me" ? "bottom right" : "bottom left" }}
                    >
                      <MessageView message={m} />
                    </motion.div>
                  ))}
                  {busy ? (
                    <motion.div
                      key="thinking"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="thinking flex items-center gap-1 px-1 py-1"
                      role="status"
                      aria-label="Thinking"
                    >
                      <i />
                      <i />
                      <i />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : (
              <p className="text-[13px] text-ink-2">
                {provider === "off"
                  ? "The assistant is off. Your question becomes a prompt you can copy, and nothing is sent."
                  : "The assistant gets summaries of this workspace, never your sensor data."}
              </p>
            )}
          </>
        )}
      </div>

      {ws ? (
        <form
          className="flex-none border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-[8px] border border-line-strong bg-surface px-2 py-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <textarea
              rows={1}
              value={draft}
              aria-label="Ask the assistant"
              placeholder="Ask about this workspace"
              className="max-h-36 min-h-[32px] grow resize-none bg-transparent px-1 py-1 text-[13.5px] outline-none placeholder:text-ink-3"
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(144, e.target.scrollHeight)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="btn btn-primary btn-sm !h-8 !min-h-8 !w-8 !p-0"
            >
              <ArrowUp size={15} weight="bold" />
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function MessageView({ message }: { message: Message }) {
  if (message.who === "me") {
    return <div className="ml-8 rounded-[10px] rounded-br-[3px] bg-ink px-3 py-2 text-[13.5px] text-on-ink">{message.text}</div>;
  }
  const who: Record<string, string> = {
    claude_code: "Claude Code",
    claude_chat: "Prompt for Claude chat",
    off: "Assistant is off",
    unavailable: "Assistant",
    error: "Error",
  };
  return (
    <div className="mr-4 rounded-[10px] rounded-bl-[3px] border border-line bg-surface-2 px-3 py-2.5">
      <div className="mb-1 text-[11.5px] font-medium text-ink-3">{who[message.source ?? ""] ?? "Assistant"}</div>
      {message.source === "claude_code" ? <Markdown text={message.text} /> : <p className="text-[13.5px]">{message.text}</p>}
      {message.prompt ? <PromptBox prompt={message.prompt} /> : null}
    </div>
  );
}

function PromptBox({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              toast("Prompt copied");
            } catch {
              toast("Copying is not available in this browser", "error");
            }
          }}
        >
          <Copy size={13} /> Copy prompt
        </button>
        <button type="button" className="text-[12.5px] text-ink-2 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide the prompt" : "Show the prompt"}
        </button>
      </div>
      {open ? <pre className="code-block mt-2 max-h-56 whitespace-pre-wrap text-[11.5px]">{prompt}</pre> : null}
    </div>
  );
}

const SPEC_TYPES = ["recipe", "task", "connectivity", "power", "priority"];
const FIELD: Record<string, string> = {
  recipe: "Use case",
  task: "Task",
  connectivity: "Radio",
  power: "Power",
  priority: "Ranking priority",
  column_role: "Column role",
  normal_label: "Normal label",
  starting_rung: "Starting method",
  issue_severity: "Data issue",
};

function DecisionItem({ decision }: { decision: Decision }) {
  const ws = useOptionalWorkspace()!;
  const action = useAction();
  const field = FIELD[decision.decision_type] ?? decision.decision_type.replaceAll("_", " ");
  const head = (
    <div className="flex items-baseline gap-2">
      <span className="font-medium">{field}</span>
      {decision.decision_type === "column_role" ? <span className="font-mono text-[12px] text-ink-3">{decision.decision_key}</span> : null}
      <span className="ml-auto font-mono text-[11.5px] text-ink-3">{Math.round(decision.confidence * 100)}% sure</span>
    </div>
  );
  if (decision.decision_type === "column_role" || decision.decision_type === "normal_label") {
    return (
      <div className="px-3.5 py-3 text-[13px]">
        {head}
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          Read as <span className="font-mono">{String(decision.answer).replaceAll("_", " ")}</span>.
        </p>
        <Link href={stepPath(ws.pid, "data")} className="mt-1 inline-block text-[12.5px] font-medium underline underline-offset-2">
          Review in Dataset
        </Link>
      </div>
    );
  }
  const choose = (o: string) =>
    action.run(async () => {
      await api(`/decisions/${decision.id}`, { method: "PATCH", json: { choice: o } });
      if (SPEC_TYPES.includes(decision.decision_type))
        await api(`/projects/${ws.pid}/spec`, { method: "PATCH", json: { [decision.decision_type]: o } });
      toast(`${field} set to ${o}`);
      await ws.refresh();
    });
  return (
    <div className="px-3.5 py-3 text-[13px]">
      {head}
      {decision.follow_up ? <p className="mt-0.5 text-[12.5px] text-ink-3">{decision.follow_up}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {decision.options.map((o) => (
          <button
            key={o}
            type="button"
            disabled={action.busy}
            onClick={() => choose(o)}
            className={cx(
              "min-h-[30px] rounded-[6px] border px-2.5 text-[12.5px] font-medium",
              o === decision.answer ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:bg-surface-2",
            )}
            title={o === decision.answer ? "Current value, not yet confirmed" : undefined}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
