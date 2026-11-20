import type { Channel } from "@/lib/db";
import { cn } from "@/lib/utils";

export function ChannelPill({ channel, className }: { channel: Channel | undefined | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground",
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: channel?.color ?? "var(--box-new)" }}
      />
      <span className="truncate">{channel?.name ?? "Без канала"}</span>
    </span>
  );
}
