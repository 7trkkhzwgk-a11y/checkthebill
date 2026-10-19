ALTER TABLE public.line_items ADD COLUMN order_no TEXT, ADD COLUMN tax_amount NUMERIC, ADD COLUMN total_amount NUMERIC;
ALTER TABLE public.bills ADD COLUMN orders_subtotal NUMERIC, ADD COLUMN sales_tax NUMERIC;
ALTER TABLE public.promises ADD COLUMN notes TEXT;
COMMENT ON COLUMN public.line_items.order_no IS 'Order number this item belongs to (invoice mode).';
COMMENT ON COLUMN public.line_items.tax_amount IS 'Order-level sales tax shown on the invoice; compared, never calculated.';
COMMENT ON COLUMN public.bills.orders_subtotal IS 'Printed Orders subtotal from an invoice; used to verify item lines add up.';
COMMENT ON COLUMN public.bills.sales_tax IS 'Printed Sales Tax total from an invoice.';