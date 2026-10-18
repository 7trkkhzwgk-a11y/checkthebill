ALTER TABLE public.bills ADD COLUMN comparison_result jsonb;
ALTER TABLE public.promises ADD COLUMN promise_kind text;
ALTER TABLE public.promises ADD CONSTRAINT promises_kind_check CHECK (promise_kind IS NULL OR promise_kind IN ('refund','contract','price_list'));
ALTER TABLE public.messages ADD COLUMN declined_at timestamptz;
COMMENT ON COLUMN public.bills.comparison_result IS 'Deterministic comparison snapshot created on explicit confirmation; contains no raw documents.';
COMMENT ON COLUMN public.promises.promise_kind IS 'Document classification for deterministic refund versus agreed-price comparisons.';