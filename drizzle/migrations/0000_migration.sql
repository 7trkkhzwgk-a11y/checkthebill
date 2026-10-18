create table public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  issuer text,
  file_link text not null,
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create table public.promises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  source text,
  item text,
  promised_amount numeric,
  reference_no text,
  bank_ref text,
  promised_on date,
  file_link text
);
create table public.line_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  date date,
  description text,
  amount numeric,
  type text check (type in ('charge','credit')),
  reference_no text,
  bank_ref text,
  flagged boolean not null default false,
  flag_reason text
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  line_id uuid not null references public.line_items(id) on delete cascade,
  sent_to text,
  draft_text text,
  final_text text,
  words_changed integer,
  sent boolean not null default false,
  sent_at timestamptz
);
grant select, insert, update, delete on public.bills, public.promises, public.line_items, public.messages to authenticated;
grant all on public.bills, public.promises, public.line_items, public.messages to service_role;
alter table public.bills enable row level security;
alter table public.promises enable row level security;
alter table public.line_items enable row level security;
alter table public.messages enable row level security;
create policy "own bills" on public.bills for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own promises" on public.promises for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lines" on public.line_items for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own messages" on public.messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index on public.line_items(bill_id);
create index on public.promises(bill_id);