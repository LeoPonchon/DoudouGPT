create extension if not exists pgcrypto;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nouveau chat',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists chats_user_updated_at_idx
  on public.chats (user_id, updated_at desc, created_at desc);

create index if not exists chat_messages_chat_created_at_idx
  on public.chat_messages (chat_id, created_at asc);

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table public.chats to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;

grant all privileges on table public.chats to service_role;
grant all privileges on table public.chat_messages to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chats'
  ) then
    alter publication supabase_realtime add table public.chats;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

create or replace function public.set_chat_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_chat_updated_at on public.chats;

create trigger set_chat_updated_at
before update on public.chats
for each row
execute function public.set_chat_updated_at();

create or replace function public.touch_chat_from_message()
returns trigger
language plpgsql
as $$
begin
  update public.chats
  set updated_at = timezone('utc', now())
  where id = new.chat_id;

  return new;
end;
$$;

drop trigger if exists touch_chat_from_message on public.chat_messages;

create trigger touch_chat_from_message
after insert on public.chat_messages
for each row
execute function public.touch_chat_from_message();

create policy "Chats are readable by owner"
on public.chats
for select
using (auth.uid() = user_id);

create policy "Chats are insertable by owner"
on public.chats
for insert
with check (auth.uid() = user_id);

create policy "Chats are updatable by owner"
on public.chats
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Chats are deletable by owner"
on public.chats
for delete
using (auth.uid() = user_id);

create policy "Messages are readable by owner"
on public.chat_messages
for select
using (auth.uid() = user_id);

create policy "Messages are insertable by owner"
on public.chat_messages
for insert
with check (auth.uid() = user_id);

create policy "Messages are updatable by owner"
on public.chat_messages
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Messages are deletable by owner"
on public.chat_messages
for delete
using (auth.uid() = user_id);
