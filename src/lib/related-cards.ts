import type { Card, Channel } from "./db";

export interface RelatedCardResult {
  card: Card;
  score: number;
  reason: string;
}

const STOP_WORDS = new Set([
  "это", "как", "что", "кто", "где", "когда", "чем", "для", "про", "или", "его", "ее", "она", "он",
  "быть", "был", "была", "были", "также", "очень", "который", "которая", "которые", "такой", "такая",
]);

function normalizeWords(card: Card): Set<string> {
  const text = [card.term, card.hook, card.full_text].filter(Boolean).join(" ").toLowerCase();
  return new Set(text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}

function isProperName(word: string): boolean {
  return /^[А-ЯЁA-Z]/u.test(word);
}

export function findRelatedCards(currentCard: Card, allCards: Card[], limit = 6, channels: Channel[] = []): RelatedCardResult[] {
  const currentWords = normalizeWords(currentCard);
  const currentCategories = new Set(currentCard.channel_ids ?? []);
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  const relatedManual = new Set(currentCard.related_card_ids ?? []);

  return allCards
    .filter((card) => card.id !== currentCard.id)
    .map((card): RelatedCardResult | null => {
      const candidateManual = new Set(card.related_card_ids ?? []);
      if (relatedManual.has(card.id) || candidateManual.has(currentCard.id)) {
        return { card, score: 1000, reason: "Связано вручную" };
      }

      if (currentCard.source_chat_id && currentCard.tg_message_id != null
        && card.source_chat_id === currentCard.source_chat_id
        && card.tg_message_id != null
        && card.tg_message_id === currentCard.tg_message_id) {
        return { card, score: 800, reason: "Из одного поста" };
      }

      const candidateWords = normalizeWords(card);
      const commonWords = [...currentWords].filter((word) => candidateWords.has(word));
      const commonCategories = (card.channel_ids ?? []).filter((id) => currentCategories.has(id));
      if (!commonWords.length && !commonCategories.length) return null;

      let score = commonCategories.length * 20;
      let reason = "";
      for (const word of commonWords) {
        score += isProperName(word) ? 60 : 35;
      }

      if (commonWords.length) {
        const keyword = [...commonWords].sort((a, b) => b.length - a.length)[0];
        reason = `Общее слово: ${keyword}`;
      } else {
        const categoryId = commonCategories[0];
        const categoryName = categoryId ? channelNames.get(categoryId) : undefined;
        reason = categoryName ? `Общий раздел: ${categoryName}` : "Общая категория";
      }

      return { card, score, reason };
    })
    .filter((item): item is RelatedCardResult => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}
