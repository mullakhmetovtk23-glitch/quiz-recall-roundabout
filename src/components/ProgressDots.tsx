import { cn } from "@/lib/utils";
import type { Card } from "@/lib/db";

const BOX_CLASS = ["bg-box-0", "bg-box-1", "bg-box-2", "bg-box-3", "bg-box-4"];

function describe(label: string, box: number, reviewed: string | null, due: string) {
  if (!reviewed) return `${label}: ещё не повторяли`;
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
  const when = days <= 0 ? "пора повторить" : `через ${days} дн.`;
  return `${label}: коробка ${box}, ${when}`;
}

function Dot({ box, reviewed, title }: { box: number; reviewed: boolean; title: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block size-2.5 rounded-full",
        reviewed ? BOX_CLASS[Math.min(Math.max(box, 0), 4)] : "border-2 border-box-new bg-transparent",
      )}
    />
  );
}

export function ProgressDots({ card }: { card: Card }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Прогресс запоминания">
      <Dot
        box={card.fwd_box}
        reviewed={!!card.fwd_reviewed_at}
        title={describe("Прямое (термин → факты)", card.fwd_box, card.fwd_reviewed_at, card.fwd_due_at)}
      />
      <Dot
        box={card.rev_box}
        reviewed={!!card.rev_reviewed_at}
        title={describe("Обратное (крючок → термин)", card.rev_box, card.rev_reviewed_at, card.rev_due_at)}
      />
    </span>
  );
}

export function BoxLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-box-new" />новая</span>
      {["не помню", "1 день", "4 дня", "14 дней", "45 дней"].map((l, i) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", BOX_CLASS[i])} />
          {l}
        </span>
      ))}
      <span>· левая точка — прямое, правая — обратное</span>
    </div>
  );
}
