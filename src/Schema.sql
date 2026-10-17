
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- Already ran an earlier version of this file? Don't run it again. Run only this line:
--   alter table public.deliveries add column if not exists dest_geojson jsonb;
 
-- 1. Tables ---------------------------------------------------------------
 
create table public.deliveries (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  driver_id   uuid references auth.users(id),
  address     text,
  dest_lat    double precision,
  dest_lng    double precision,
  dest_geojson jsonb,  -- outline of the house, when OpenStreetMap has one
  status      text not null default 'pending'
              check (status in ('pending', 'on_the_way', 'delivered')),
  created_at  timestamptz not null default now()
);
 
-- One row per delivery, overwritten on every update. No location history is kept.
create table public.driver_locations (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  updated_at  timestamptz not null default now()
);
 
-- The server sets the timestamp, so a phone with a wrong clock can't confuse the customer.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
 
create trigger driver_locations_touch
before insert or update on public.driver_locations
for each row execute function public.touch_updated_at();
 
-- 2. Security: Row Level Security -----------------------------------------
-- The public "anon" key ships inside your website, so anyone can find it.
-- These policies are what actually decide who can read or write each row.
 
alter table public.deliveries enable row level security;
alter table public.driver_locations enable row level security;
 
-- Deliveries: customers and drivers see only their own.
create policy "read own deliveries" on public.deliveries
  for select to authenticated
  using (auth.uid() = customer_id or auth.uid() = driver_id);
 
-- A customer can create a delivery for themselves, always starting unassigned and pending.
create policy "customer creates delivery" on public.deliveries
  for insert to authenticated
  with check (auth.uid() = customer_id and driver_id is null and status = 'pending');
 
-- A driver can only change the status of a delivery assigned to them...
create policy "driver updates status" on public.deliveries
  for update to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id and status in ('on_the_way', 'delivered'));
 
-- ...and status is the ONLY column anyone can update through the API.
revoke update on public.deliveries from anon, authenticated;
grant update (status) on public.deliveries to authenticated;
 
-- Driver locations: only the assigned driver can write, and only during an active trip.
create policy "driver writes location" on public.driver_locations
  for insert to authenticated
  with check (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.driver_id = auth.uid() and d.status = 'on_the_way'
  ));
 
create policy "driver updates location" on public.driver_locations
  for update to authenticated
  using (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.driver_id = auth.uid() and d.status = 'on_the_way'
  ))
  with check (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.driver_id = auth.uid() and d.status = 'on_the_way'
  ));
 
create policy "driver reads own location" on public.driver_locations
  for select to authenticated
  using (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.driver_id = auth.uid()
  ));
 
create policy "driver deletes location" on public.driver_locations
  for delete to authenticated
  using (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.driver_id = auth.uid()
  ));
 
-- The customer can see the driver ONLY for their own delivery, and ONLY while it is on the way.
create policy "customer reads live location" on public.driver_locations
  for select to authenticated
  using (exists (
    select 1 from public.deliveries d
    where d.id = delivery_id and d.customer_id = auth.uid() and d.status = 'on_the_way'
  ));
 
-- 3. Realtime: push changes to the customer's page instantly ---------------
-- Realtime respects the policies above, so customers only receive their own driver's updates.
 
alter publication supabase_realtime add table public.deliveries, public.driver_locations;
 
-- 4. Test data (run separately, after creating two users) -----------------
-- Authentication > Users > Add user, create one "customer" and one "driver",
-- then copy each user's UUID into the placeholders below.
--
-- insert into public.deliveries (customer_id, driver_id, address, dest_lat, dest_lng)
-- values ('<customer-uuid>', '<driver-uuid>', 'Test address', <lat>, <lng>);
--
-- Then open these two pages, each signed in as the matching user:
--   /?mode=driver&delivery=<delivery-uuid>   (the driver's phone)
--   /?mode=track&delivery=<delivery-uuid>    (the customer's browser)