CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#e4572e',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO anon, authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access to channels" ON public.channels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  term text NOT NULL DEFAULT '',
  hook text NOT NULL DEFAULT '',
  full_text text NOT NULL DEFAULT '',
  image_url text,
  source_chat_id text,
  tg_message_id bigint,
  fwd_box smallint NOT NULL DEFAULT 0,
  fwd_due_at timestamptz NOT NULL DEFAULT now(),
  fwd_reviewed_at timestamptz,
  rev_box smallint NOT NULL DEFAULT 0,
  rev_due_at timestamptz NOT NULL DEFAULT now(),
  rev_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(term, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(hook, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce(full_text, '')), 'C')
  ) STORED,
  CONSTRAINT cards_tg_unique UNIQUE (source_chat_id, tg_message_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO anon, authenticated;
GRANT ALL ON public.cards TO service_role;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access to cards" ON public.cards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX cards_search_idx ON public.cards USING gin (search_vector);
CREATE INDEX cards_channel_idx ON public.cards (channel_id);
CREATE INDEX cards_fwd_due_idx ON public.cards (fwd_due_at);
CREATE INDEX cards_rev_due_idx ON public.cards (rev_due_at);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cards_touch_updated_at BEFORE UPDATE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.channel_stats()
RETURNS TABLE (channel_id uuid, total bigint, due_forward bigint, due_reverse bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.channel_id,
         count(*) AS total,
         count(*) FILTER (WHERE c.fwd_due_at <= now()) AS due_forward,
         count(*) FILTER (WHERE c.rev_due_at <= now()) AS due_reverse
  FROM public.cards c
  GROUP BY c.channel_id;
$$;

GRANT EXECUTE ON FUNCTION public.channel_stats() TO anon, authenticated, service_role;

INSERT INTO public.channels (name, color, sort_order) VALUES
  ('Литература и философия', '#8c5a3c', 1),
  ('Наука и медицина', '#2a9d8f', 2),
  ('История и быт', '#b5651d', 3),
  ('Искусство', '#c2185b', 4),
  ('Кино и сериалы', '#5c6bc0', 5),
  ('Музыка', '#7cb342', 6),
  ('География', '#0277bd', 7),
  ('Спорт', '#f9a825', 8),
  ('Абстрактная бинга', '#e4572e', 9);