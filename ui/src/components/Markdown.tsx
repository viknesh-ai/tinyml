import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-surface-2 px-1 text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

/** A small Markdown renderer for assistant answers and package reports. It never injects HTML. */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] | null = null;
  let code: string[] | null = null;
  const flushList = () => {
    if (list)
      out.push(
        <ul key={`l${out.length}`} className="my-2 list-disc space-y-1 pl-5">
          {list}
        </ul>,
      );
    list = null;
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      if (code) {
        out.push(
          <pre key={`c${i}`} className="code-block my-2">
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flushList();
        code = [];
      }
      return;
    }
    if (code) {
      code.push(raw);
      return;
    }
    const item = line.match(/^\s*(?:[-*]|\d+\.) (.*)/);
    if (item) {
      list = list ?? [];
      list.push(<li key={i}>{inline(item[1])}</li>);
      return;
    }
    flushList();
    if (!line.trim()) return;
    if (line.startsWith("### "))
      out.push(
        <h4 key={i} className="mt-3 font-semibold">
          {inline(line.slice(4))}
        </h4>,
      );
    else if (line.startsWith("## "))
      out.push(
        <h3 key={i} className="mt-4 text-[15px] font-semibold">
          {inline(line.slice(3))}
        </h3>,
      );
    else if (line.startsWith("# "))
      out.push(
        <h2 key={i} className="mt-2 text-[17px] font-semibold">
          {inline(line.slice(2))}
        </h2>,
      );
    else if (line.startsWith("> "))
      out.push(
        <blockquote key={i} className="my-2 border-l-2 border-line-strong pl-3 text-ink-2">
          {inline(line.slice(2))}
        </blockquote>,
      );
    else
      out.push(
        <p key={i} className="my-1.5">
          {inline(line)}
        </p>,
      );
  });
  flushList();
  if (code)
    out.push(
      <pre key="c-end" className="code-block my-2">
        {(code as string[]).join("\n")}
      </pre>,
    );
  return <div className="text-[13.5px] leading-relaxed">{out}</div>;
}
