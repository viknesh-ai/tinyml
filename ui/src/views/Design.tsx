import { PageHeader } from "../components/ui";
import { useWorkspace } from "../data";
import { num } from "../format";
import { PipelineBlocks } from "./PipelineBlocks";

export function Design() {
  const ws = useWorkspace();
  const tr = ws.data.training;
  const rate = tr?.sample_rate_hz;
  return (
    <div>
      <PageHeader title="Pipeline design" lede="How a recording becomes an answer: windows, then measurements, then the model." />
      <PipelineBlocks />
      {tr && rate ? (
        <p className="mt-5 max-w-[76ch] text-[13px] text-ink-2">
          Each answer looks at {num(tr.window_samples)} samples ({num(((tr.window_samples ?? 0) / rate) * 1000)} ms) and a new window starts
          every {num(tr.hop)} samples. The window settings come from the use-case recipe; the measurements and the model are chosen in
          Training, which tries the simplest methods first.
        </p>
      ) : null}
    </div>
  );
}
