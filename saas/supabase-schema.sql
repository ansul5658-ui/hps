-- Run this in your Supabase SQL editor

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  instagram_user_id text,
  instagram_username text,
  instagram_access_token text,
  followers_count int default 0,
  following_count int default 0,
  media_count int default 0,
  engagement_rate numeric(5,2) default 0,
  plan text default 'free' check (plan in ('free','starter','pro','agency')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now()
);

create table if not exists dm_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  trigger text not null check (trigger in ('new_follower','story_reply','comment_keyword','dm_received')),
  keyword text,
  message_template text not null,
  use_ai boolean default false,
  ai_tone text default 'friendly' check (ai_tone in ('friendly','professional','casual','formal')),
  is_active boolean default true,
  sent_count int default 0,
  created_at timestamptz default now()
);

create table if not exists dm_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  rule_id uuid references dm_rules(id) on delete set null,
  recipient_id text not null,
  recipient_username text not null,
  message text not null,
  status text default 'pending' check (status in ('sent','failed','pending')),
  created_at timestamptz default now()
);

create table if not exists analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  followers_count int not null,
  following_count int not null,
  media_count int not null,
  engagement_rate numeric(5,2) default 0,
  dm_sent_today int default 0,
  recorded_at timestamptz default now()
);

-- RLS
alter table profiles enable row level security;
alter table dm_rules enable row level security;
alter table dm_logs enable row level security;
alter table analytics_snapshots enable row level security;

create policy "Users own their profile" on profiles for all using (auth.uid() = id);
create policy "Users own their dm_rules" on dm_rules for all using (auth.uid() = user_id);
create policy "Users own their dm_logs" on dm_logs for all using (auth.uid() = user_id);
create policy "Users own their analytics" on analytics_snapshots for all using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
