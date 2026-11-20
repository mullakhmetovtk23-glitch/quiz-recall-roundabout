import { Link2 } from "lucide-react";
import { ChannelPill } from "./ChannelPill";
import type { Card, Channel } from "@/lib/db";
import type { RelatedCardResult } from "@/lib/related-cards";

interface Props {
  cards: RelatedCardResult[];
  channels: Channel[];
  onSelectCard: (card: Card) => void;
}

export function RelatedCardsSection({ cards, channels, onSelectCard }: Props) {
  if (!cards.length) return null;
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Похожие карточки</h3>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{cards.length}</span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {cards.map(({ card, reason }) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => onSelectCard(card)}
              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-secondary"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{card.term || "Без термина"}</div>
                  {card.hook && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.hook}</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">{reason}</span>
                {(card.channel_ids ?? []).slice(0, 2).map((id) => (
                  <ChannelPill key={id} channel={channelMap.get(id)} className="px-2 py-0 text-[10px]" />
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
