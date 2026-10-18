ALTER TABLE public.bills ADD COLUMN currency text;
ALTER TABLE public.bills ADD CONSTRAINT bills_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
ALTER TABLE public.promises ADD COLUMN pnr text;
ALTER TABLE public.messages ADD COLUMN draft_version integer;
COMMENT ON COLUMN public.bills.currency IS 'Printed document currency code; null when unknown.';
COMMENT ON COLUMN public.promises.pnr IS 'Full booking PNR, never masked.';
COMMENT ON COLUMN public.messages.draft_version IS 'Presentation version; only untouched unsent drafts may be upgraded.';