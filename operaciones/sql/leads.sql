-- Captura de leads de las páginas públicas (home, administradores, convenios, departamentos)
-- y vista en el panel de operaciones (solo rol plataforma).

create table if not exists echo_privado.leads (
  id bigint generated always as identity primary key,
  creado_at timestamptz not null default now(),
  tipo text not null check (tipo in ('comite','inversionista','administrador','convenio','departamento')),
  estado text not null default 'nuevo' check (estado in ('nuevo','contactado','en_proceso','ganado','descartado')),
  nombre text check (char_length(nombre) <= 120),
  telefono text check (char_length(telefono) <= 40),
  email text check (char_length(email) <= 254),
  empresa text check (char_length(empresa) <= 160),
  ciudad text check (char_length(ciudad) <= 160),
  mensaje text check (char_length(mensaje) <= 2000),
  datos jsonb not null default '{}'::jsonb check (pg_column_size(datos) <= 8000),
  pagina text check (char_length(pagina) <= 300),
  landing text check (char_length(landing) <= 300),
  referrer text check (char_length(referrer) <= 500),
  utm_source text check (char_length(utm_source) <= 120),
  utm_medium text check (char_length(utm_medium) <= 120),
  utm_campaign text check (char_length(utm_campaign) <= 160),
  utm_content text check (char_length(utm_content) <= 160),
  utm_term text check (char_length(utm_term) <= 160),
  nota text check (char_length(nota) <= 2000),
  actualizado_at timestamptz,
  actualizado_por text
);
alter table echo_privado.leads enable row level security;
create index if not exists leads_creado_idx on echo_privado.leads (creado_at desc);
revoke all on echo_privado.leads from public, anon, authenticated;

-- Registro público (anon). Guarda el lead antes de que la persona abra WhatsApp.
create or replace function public.echo_registrar_lead(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  t text := p_datos->>'tipo';
  v_nombre text := nullif(left(btrim(coalesce(p_datos->>'nombre','')),120),'');
  v_tel text := nullif(left(btrim(coalesce(p_datos->>'telefono','')),40),'');
  v_email text := nullif(lower(left(btrim(coalesce(p_datos->>'email','')),254)),'');
  v_extra jsonb := case when jsonb_typeof(p_datos->'datos')='object' then p_datos->'datos' else '{}'::jsonb end;
  o jsonb := case when jsonb_typeof(p_datos->'origen')='object' then p_datos->'origen' else '{}'::jsonb end;
begin
  if t is null or t not in ('comite','inversionista','administrador','convenio','departamento') then
    return jsonb_build_object('ok',false,'error','Tipo de lead inválido.');
  end if;
  if t <> 'departamento' and v_nombre is null and v_tel is null and v_email is null then
    return jsonb_build_object('ok',false,'error','Falta un dato de contacto.');
  end if;
  if pg_column_size(v_extra) > 6000 then v_extra := '{}'::jsonb; end if;
  -- Límite global contra abuso.
  if (select count(*) from echo_privado.leads where creado_at > now() - interval '10 minutes') >= 300 then
    return jsonb_build_object('ok',false,'error','Intenta de nuevo en unos minutos.');
  end if;
  -- Evita duplicados del mismo contacto y tipo en 30 minutos.
  if (v_tel is not null or v_email is not null) and exists (
    select 1 from echo_privado.leads l where l.tipo=t and l.creado_at > now() - interval '30 minutes'
      and l.telefono is not distinct from v_tel and l.email is not distinct from v_email) then
    return jsonb_build_object('ok',true,'duplicado',true);
  end if;
  insert into echo_privado.leads(tipo,nombre,telefono,email,empresa,ciudad,mensaje,datos,pagina,landing,referrer,
    utm_source,utm_medium,utm_campaign,utm_content,utm_term)
  values (t, v_nombre, v_tel, v_email,
    nullif(left(btrim(coalesce(p_datos->>'empresa','')),160),''),
    nullif(left(btrim(coalesce(p_datos->>'ciudad','')),160),''),
    nullif(left(btrim(coalesce(p_datos->>'mensaje','')),2000),''),
    v_extra,
    nullif(left(coalesce(o->>'pagina',''),300),''),
    nullif(left(coalesce(o->>'landing',''),300),''),
    nullif(left(coalesce(o->>'referrer',''),500),''),
    nullif(left(coalesce(o->>'utm_source',''),120),''),
    nullif(left(coalesce(o->>'utm_medium',''),120),''),
    nullif(left(coalesce(o->>'utm_campaign',''),160),''),
    nullif(left(coalesce(o->>'utm_content',''),160),''),
    nullif(left(coalesce(o->>'utm_term',''),160),''));
  return jsonb_build_object('ok',true);
end;
$$;

-- Panel de operaciones: listar y actualizar estado (solo plataforma).
create or replace function public.pg_operaciones_leads(p_user text, p_password text, p_accion jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  v_estado text := p_accion->>'estado';
  v_nota text := nullif(left(btrim(coalesce(p_accion->>'nota','')),2000),'');
begin
  if v_admin.rol is distinct from 'plataforma' then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if p_accion is null then
    return jsonb_build_object('ok',true,'leads',coalesce((
      select jsonb_agg(to_jsonb(l) order by l.creado_at desc)
      from (select * from echo_privado.leads order by creado_at desc limit 2000) l
    ),'[]'::jsonb));
  end if;
  if p_accion->>'tipo' is distinct from 'actualizar' or coalesce(p_accion->>'id','') !~ '^[0-9]{1,15}$'
     or coalesce(v_estado,'') not in ('nuevo','contactado','en_proceso','ganado','descartado') then
    return jsonb_build_object('ok',false,'error','Acción inválida.');
  end if;
  update echo_privado.leads set estado=v_estado, nota=coalesce(v_nota,nota),
    actualizado_at=now(), actualizado_por=v_admin.user_id
  where id=(p_accion->>'id')::bigint;
  if not found then return jsonb_build_object('ok',false,'error','No encontramos el lead.'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.echo_registrar_lead(jsonb), public.pg_operaciones_leads(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.echo_registrar_lead(jsonb), public.pg_operaciones_leads(text,text,jsonb) to anon, authenticated;
