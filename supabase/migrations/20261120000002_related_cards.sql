ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS related_card_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS cards_related_card_ids_idx
  ON public.cards USING gin (related_card_ids);
