create extension if not exists pgcrypto;

create table if not exists public.barber_bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text default '',
  service text not null,
  booking_date date not null,
  booking_time text not null,
  status text not null default 'Pending',
  cancel_code text not null,
  cancel_token uuid not null default gen_random_uuid(),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists barber_active_slot_unique
on public.barber_bookings (booking_date, booking_time)
where status not in ('Cancelled','No Show');

alter table public.barber_bookings enable row level security;
-- No public policies are required. Netlify Functions use the service-role key.


grant select, insert, update, delete on public.barber_bookings to service_role;
