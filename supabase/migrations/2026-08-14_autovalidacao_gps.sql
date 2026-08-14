-- Migração: o GPS impreciso deixa de travar a auto-validação.
--
-- Se o registo caiu dentro do raio de uma obra ATRIBUÍDA ao funcionário,
-- a imprecisão do GPS não muda a conclusão — o aviso continua guardado e
-- visível para auditoria, apenas não impede a validação automática.
-- Relógio desviado e sincronização offline continuam a exigir revisão,
-- porque aí é a própria hora que não é de confiança.

create or replace function public.prepare_time_entry()
returns trigger
language plpgsql
as $$
declare
  f jsonb := '{}'::jsonb;
  matched_id uuid;
  has_sites boolean;
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
    new.entry_date := (new.client_timestamp at time zone 'Europe/Lisbon')::date;
    f := f || jsonb_build_object('offline_sync', true);
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
