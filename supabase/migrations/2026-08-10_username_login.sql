-- Migração: login por username (correr APENAS se a base de dados já foi
-- criada com uma versão do schema.sql anterior a esta alteração;
-- instalações novas já incluem isto no schema.sql).

alter table public.profiles add column if not exists username text unique;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'employee'),
    nullif(new.raw_user_meta_data ->> 'username', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
