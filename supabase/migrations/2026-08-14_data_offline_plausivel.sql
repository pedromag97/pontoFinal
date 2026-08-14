-- Migração: recusar datas implausíveis nos registos sincronizados offline.
--
-- Sem rede não há relógio de servidor, por isso a data de um registo
-- offline vem do telemóvel. Para essa data não poder ser usada para
-- empurrar trabalho para outro dia qualquer, só se aceita quando é
-- plausível: não pode estar no futuro nem ter mais de 7 dias.
-- Fora dessa janela, a data do telemóvel é RECUSADA — o registo é
-- guardado à mesma (o trabalho existiu), mas fica no dia do servidor e
-- sinalizado com "bad_client_clock" para revisão obrigatória.
--
-- Mantém-se o que já existia: todos os registos offline levam a marca
-- "offline_sync" e nunca são validados automaticamente.

create or replace function public.prepare_time_entry()
returns trigger
language plpgsql
as $$
declare
  f jsonb := '{}'::jsonb;
  matched_id uuid;
  has_sites boolean;
  data_plausivel boolean;
begin
  new.manual := coalesce(new.manual, false);

  -- Registo manual criado pelo backoffice (service role):
  -- a hora é a definida pelo admin; fica sinalizado para auditoria.
  if new.manual and auth.role() = 'service_role' then
    new.created_at := coalesce(new.created_at, now());
    new.entry_date := (new.created_at at time zone 'Europe/Lisbon')::date;
    new.synced_offline := false;
    new.flags := jsonb_build_object('manual', true);
    return new;
  end if;
  new.manual := false;

  -- Registos normais exigem GPS (a app garante; isto trava clientes forjados).
  if new.latitude is null or new.longitude is null then
    raise exception 'GPS obrigatório';
  end if;

  new.created_at := now();
  new.synced_offline := coalesce(new.synced_offline, false);

  if new.synced_offline and new.client_timestamp is not null then
    f := f || jsonb_build_object('offline_sync', true);

    -- Janela aceitável para a hora que o telemóvel diz ter:
    -- nada no futuro (5 min de tolerância) e nada com mais de 7 dias.
    data_plausivel :=
      new.client_timestamp <= now() + interval '5 minutes'
      and new.client_timestamp >= now() - interval '7 days';

    if data_plausivel then
      new.entry_date := (new.client_timestamp at time zone 'Europe/Lisbon')::date;
    else
      -- Data recusada: fica no dia do servidor e sinalizada.
      new.entry_date := (now() at time zone 'Europe/Lisbon')::date;
      f := f || jsonb_build_object('bad_client_clock', true);
    end if;
  else
    new.entry_date := (now() at time zone 'Europe/Lisbon')::date;
    if new.client_timestamp is not null
       and abs(extract(epoch from (now() - new.client_timestamp))) > 300 then
      f := f || jsonb_build_object('clock_drift', true);
    end if;
  end if;

  if new.gps_accuracy is not null and new.gps_accuracy > 100 then
    f := f || jsonb_build_object('low_gps_accuracy', true);
  end if;

  select exists (select 1 from public.worksites where active and not mobile)
    into has_sites;
  if has_sites then
    select ws.id into matched_id
    from public.worksites ws
    where ws.active
      and not ws.mobile
      and public.haversine_m(new.latitude, new.longitude,
                             ws.latitude, ws.longitude) <= ws.radius_m
    order by public.haversine_m(new.latitude, new.longitude,
                                ws.latitude, ws.longitude)
    limit 1;

    if matched_id is not null then
      new.worksite_id := matched_id;
      -- Obra atribuída ao funcionário e sem avisos que ponham a hora em
      -- causa (o GPS impreciso não conta: o registo caiu dentro do raio).
      -- Os registos offline ficam sempre de fora — a hora não é do servidor.
      if (f - 'low_gps_accuracy') = '{}'::jsonb and exists (
        select 1 from public.employee_worksites ew
        where ew.employee_id = new.employee_id
          and ew.worksite_id = matched_id
      ) then
        new.validated_at := now();
        new.validated_by := null; -- validação automática do sistema
      end if;
    else
      f := f || jsonb_build_object('out_of_area', true);
    end if;
  end if;

  new.flags := f;
  return new;
end;
$$;
