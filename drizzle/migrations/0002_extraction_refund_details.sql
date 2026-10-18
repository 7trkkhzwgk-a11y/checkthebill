ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS bill_total numeric;
ALTER TABLE public.promises ADD COLUMN IF NOT EXISTS original_charge numeric, ADD COLUMN IF NOT EXISTS transaction_id text, ADD COLUMN IF NOT EXISTS status_text text;
COMMENT ON COLUMN public.bills.bill_total IS 'Printed statement total, never a transaction line or calculated value';