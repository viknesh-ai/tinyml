import { ArrowSquareOut, Check, ChatCircleText } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link } from "wouter";
import { api } from "../api";
import { toast } from "../components/Toast";
import { Button, LevelIcon, Prov, Status, cx } from "../components/ui";
import { stepPath, useAction, useJobs, useWorkspace, type StepKey } from "../data";
import { SPRING } from "../motion";
import type { ReviewCard as Card } from "../types";

const STATUS = {
  approved: ["ok", "Approved"],
  changes_requested: ["warn", "Changes requested"],
  pending: ["warn", "Needs your review"],
} as const;

export function ReviewCard({ card, onAsk }: { card: Card; onAsk: (question: string) => void }) {
  const ws = useWorkspace();
  const jobs = useJobs();
  const approve = useAction();
  const save = useAction();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [tone, label] = STATUS[card.status];

  return (
    <article
      id={`review-${card.stage}`}
      className={cx(
        "panel scroll-mt-3 overflow-hidden transition-[border-color] duration-300",
        card.status === "pending" && "border-warn/50",
      )}
    >
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <h3 className="grow text-[14px] font-semibold">{card.title}</h3>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={card.status}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={SPRING}
            >
              <Status tone={tone}>
                {card.status === "approved" ? <Check size={12} weight="bold" /> : null}
                {label}
              </Status>
            </motion.span>
          </AnimatePresence>
        </div>
        <p className="mt-2 text-[13.5px] leading-snug">{card.headline}</p>

        {card.facts.length ? (
          <dl className="mt-3 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 text-[12.5px]">
            {card.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="border-t border-dashed border-line py-1.5 text-ink-3">{f.label}</dt>
                <dd className="m-0 min-w-0 border-t border-dashed border-line py-1.5 font-mono text-[12px] [overflow-wrap:anywhere]">
                  {f.value}
                  {f.tag ? <Prov tag={f.tag} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {card.checks.length ? (
          <ul className="mt-3 space-y-1.5">
            {card.checks.map((c, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                <span className="mt-px">
                  <LevelIcon level={c.level} size={14} />
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {card.note ? (
          <p className="mt-3 rounded-[6px] bg-surface-2 px-3 py-2 text-[12.5px]">
            <span className="font-medium">Your note:</span> {card.note}
          </p>
        ) : null}

        {noting ? (
          <div className="mt-3 space-y-2">
            <label className="block text-[12.5px] font-medium" htmlFor={`note-${card.stage}`}>
              What should change?
            </label>
            <textarea
              id={`note-${card.stage}`}
              autoFocus
              className="field-input min-h-[72px] text-[13px]"
              placeholder="Kept in the review log with this stage"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                busy={save.busy}
                onClick={() =>
                  save.run(async () => {
                    if (!note.trim()) throw new Error("Write what should change first");
                    await api(`/projects/${ws.pid}/reviews`, { json: { stage: card.stage, status: "changes_requested", note } });
                    toast("Noted. Make the change, then run the stage again.");
                    setNoting(false);
                    setNote("");
                    await ws.refresh();
                  })
                }
              >
                Save note
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNoting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2">
        {card.status !== "approved" ? (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              busy={approve.busy}
              onClick={() => approve.run(() => jobs.approve(card.stage))}
            >
              Approve
            </Button>
            {!noting ? (
              <Button size="sm" onClick={() => setNoting(true)}>
                Request changes
              </Button>
            ) : null}
          </>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={ChatCircleText}
          onClick={() => onAsk(`Review the ${card.title.toLowerCase()} results. What should I check before I continue?`)}
        >
          Second opinion
        </Button>
        {ws.step !== card.step ? (
          <Link href={stepPath(ws.pid, card.step as StepKey)} className="btn btn-sm btn-ghost ml-auto">
            Open stage
            <ArrowSquareOut size={13} />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
