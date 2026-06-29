-- CRM (additive-only): create crm_leads. Touches nothing existing.
-- Review and apply manually in Supabase (MCP/dashboard). Do NOT run blindly against prod.

create table if not exists public.crm_leads (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    phone       text,
    email       text,
    source      text check (source in ('phone','whatsapp','email','referral','website','other')),
    status      text not null default 'new'
                check (status in ('new','contacted','qualified','converted','lost')),
    notes       text,
    created_by  uuid references auth.users (id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists crm_leads_status_idx     on public.crm_leads (status);
create index if not exists crm_leads_created_at_idx  on public.crm_leads (created_at desc);

-- keep updated_at fresh on every update (crm_-prefixed, additive)
create or replace function public.crm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists crm_leads_set_updated_at on public.crm_leads;
create trigger crm_leads_set_updated_at
    before update on public.crm_leads
    for each row execute function public.crm_set_updated_at();

-- RLS: admin-only, mirroring the app's require_admin guard (defense in depth).
-- Assumes the existing table public.profiles(id uuid = auth user id, role text).
alter table public.crm_leads enable row level security;

drop policy if exists crm_leads_admin_all on public.crm_leads;
create policy crm_leads_admin_all
    on public.crm_leads
    for all
    to authenticated
    using (exists (select 1 from public.profiles p
                   where p.id = auth.uid() and p.role = 'admin'))
    with check (exists (select 1 from public.profiles p
                        where p.id = auth.uid() and p.role = 'admin'));
