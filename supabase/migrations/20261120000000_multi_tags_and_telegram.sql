ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS channel_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE public.cards SET channel_ids = ARRAY[channel_id]
WHERE channel_id IS NOT NULL AND cardinality(channel_ids) = 0;
CREATE INDEX IF NOT EXISTS cards_channel_ids_idx ON public.cards USING gin (channel_ids);
COMMENT ON COLUMN public.cards.channel_id IS 'DEPRECATED: replaced by channel_ids';

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS tg_chat_id text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS ai_prompt text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS auto_edit_tg boolean NOT NULL DEFAULT false;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS tg_post_template text DEFAULT '<b>{{term}}</b>

🪝 {{hook}}

{{full_text}}

🏷 {{categories}}';
UPDATE public.channels SET tg_post_template = '<b>{{term}}</b>

🪝 {{hook}}

{{full_text}}

🏷 {{categories}}' WHERE tg_post_template IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS channels_tg_chat_id_key ON public.channels (tg_chat_id) WHERE tg_chat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.channel_stats()
RETURNS TABLE (channel_id uuid, total bigint, due_forward bigint, due_reverse bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.ch AS channel_id,
         count(*) AS total,
         count(*) FILTER (WHERE c.fwd_due_at <= now()) AS due_forward,
         count(*) FILTER (WHERE c.rev_due_at <= now()) AS due_reverse
  FROM public.cards c
  CROSS JOIN LATERAL unnest(CASE WHEN cardinality(c.channel_ids) = 0 THEN ARRAY[NULL::uuid] ELSE c.channel_ids END) AS t(ch)
  GROUP BY t.ch;
$$;

CREATE OR REPLACE FUNCTION public.merge_channels(_source uuid, _target uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF _source = _target THEN RAISE EXCEPTION 'Нельзя объединить канал сам с собой'; END IF;
  UPDATE public.cards SET channel_ids = CASE
    WHEN _target = ANY(channel_ids) THEN array_remove(channel_ids, _source)
    ELSE array_replace(channel_ids, _source, _target) END
  WHERE _source = ANY(channel_ids);
  DELETE FROM public.channels WHERE id = _source;
END;
$$;
GRANT EXECUTE ON FUNCTION public.channel_stats() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_channels(uuid, uuid) TO anon, authenticated, service_role;
