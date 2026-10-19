CREATE TABLE public.price_list_cache (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content_hash text NOT NULL,
 extraction jsonb NOT NULL, file_link text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, content_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_list_cache TO authenticated;
GRANT ALL ON public.price_list_cache TO service_role;
ALTER TABLE public.price_list_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_cache_owner ON public.price_list_cache FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TABLE public.ai_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, bill_id uuid REFERENCES public.bills(id) ON DELETE CASCADE,
 reading_id uuid, step text NOT NULL, model text NOT NULL, tokens integer NOT NULL DEFAULT 0 CHECK(tokens >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_owner ON public.ai_usage FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);