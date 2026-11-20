ALTER TABLE public.cards ADD COLUMN channel_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.cards ADD COLUMN tg_rendered_text text;
UPDATE public.cards SET channel_ids = ARRAY[channel_id] WHERE channel_id IS NOT NULL;
CREATE INDEX cards_channel_ids_idx ON public.cards USING gin (channel_ids);
COMMENT ON COLUMN public.cards.channel_id IS 'DEPRECATED: replaced by channel_ids';

ALTER TABLE public.channels ADD COLUMN tg_chat_id text;
ALTER TABLE public.channels ADD COLUMN description text;
ALTER TABLE public.channels ADD COLUMN icon text;
ALTER TABLE public.channels ADD COLUMN ai_prompt text;
ALTER TABLE public.channels ADD COLUMN auto_edit_tg boolean NOT NULL DEFAULT false;
ALTER TABLE public.channels ADD COLUMN tg_post_template text DEFAULT E'<b>{{term}}</b>\n\n🪝 {{hook}}\n\n{{full_text}}\n\n🏷 {{categories}}';
UPDATE public.channels SET tg_post_template = E'<b>{{term}}</b>\n\n🪝 {{hook}}\n\n{{full_text}}\n\n🏷 {{categories}}' WHERE tg_post_template IS NULL;
CREATE UNIQUE INDEX channels_tg_chat_id_key ON public.channels (tg_chat_id) WHERE tg_chat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.channel_stats()
RETURNS TABLE (channel_id uuid, total bigint, due_forward bigint, due_reverse bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.ch AS channel_id,
         count(*) AS total,
         count(*) FILTER (WHERE c.fwd_due_at <= now()) AS due_forward,
         count(*) FILTER (WHERE c.rev_due_at <= now()) AS due_reverse
  FROM public.cards c
  CROSS JOIN LATERAL unnest(
    CASE WHEN cardinality(c.channel_ids) = 0 THEN ARRAY[NULL::uuid] ELSE c.channel_ids END
  ) AS t(ch)
  GROUP BY t.ch;
$$;

CREATE OR REPLACE FUNCTION public.card_totals()
RETURNS TABLE (total bigint, due_forward bigint, due_reverse bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*),
         count(*) FILTER (WHERE fwd_due_at <= now()),
         count(*) FILTER (WHERE rev_due_at <= now())
  FROM public.cards;
$$;
GRANT EXECUTE ON FUNCTION public.card_totals() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_channels(_source uuid, _target uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _tg text;
BEGIN
  IF _source = _target THEN
    RAISE EXCEPTION 'Нельзя объединить канал сам с собой';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = _target) THEN
    RAISE EXCEPTION 'Целевой канал не найден';
  END IF;
  UPDATE public.cards
     SET channel_ids = CASE
           WHEN _target = ANY(channel_ids) THEN array_remove(channel_ids, _source)
           ELSE array_replace(channel_ids, _source, _target)
         END
   WHERE _source = ANY(channel_ids);
  SELECT tg_chat_id INTO _tg FROM public.channels WHERE id = _source;
  DELETE FROM public.channels WHERE id = _source;
  IF _tg IS NOT NULL THEN
    UPDATE public.channels SET tg_chat_id = _tg WHERE id = _target AND tg_chat_id IS NULL;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.merge_channels(uuid, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_channel_from_cards()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.cards SET channel_ids = array_remove(channel_ids, OLD.id) WHERE OLD.id = ANY(channel_ids);
  RETURN OLD;
END;
$$;
CREATE TRIGGER channels_remove_from_cards AFTER DELETE ON public.channels
FOR EACH ROW EXECUTE FUNCTION public.remove_channel_from_cards();