create table echo_privado.operaciones_usuarios (
  id bigint generated always as identity primary key,
  condominio_id integer not null references public.condominios(id),
  usuario text not null unique,
  nombre text not null,
  password_hash text not null,
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  creado_por text not null
);
create index operaciones_usuarios_condominio_idx on echo_privado.operaciones_usuarios(condominio_id,id);
alter table echo_privado.operaciones_usuarios enable row level security;
revoke all on echo_privado.operaciones_usuarios from public, anon, authenticated;

-- Keep local credentials out of the legacy administrator table.
create or replace function echo_privado.operaciones_admin(p_user text,p_password text)
returns public.admins language sql stable set search_path = pg_catalog as $$
  select a from public.admins a
  where a.user_id=p_user and p_password<>'' and a.password_hash is not null
    and extensions.crypt(p_password,a.password_hash)=a.password_hash
  union all
  select jsonb_populate_record(null::public.admins,jsonb_build_object(
    'id',-u.id,'user_id',u.usuario,'rol','operaciones_local',
    'condominio_id',u.condominio_id))
  from echo_privado.operaciones_usuarios u
  where u.usuario=lower(p_user) and u.activo and p_password<>''
    and extensions.crypt(p_password,u.password_hash)=u.password_hash
  limit 1;
$$;

create or replace function echo_privado.operaciones_acceso(a public.admins,p_condominio bigint)
returns boolean language sql stable set search_path = pg_catalog as $$
  select a.id is not null and exists (
    select 1 from public.condominios c
    where c.id=p_condominio and c.activo and c.codigo is distinct from 'APP-REVIEW'
      and case when a.rol='operaciones_local' then c.id=a.condominio_id
        else a.rol='plataforma' or c.id=a.condominio_id or c.id=any(a.condominios_permitidos)
          or exists (select 1 from public.admin_condominios ac where ac.admin_user=a.user_id and ac.condominio_id=c.id)
      end
  );
$$;

-- Reject NULL passwords before the older bcrypt comparisons.
do $$
declare
  f record;
  comprobacion constant text := '(v_hash[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+)(v_hash[[:space:]]*<>[[:space:]]*extensions[.]crypt[[:space:]]*[(][[:space:]]*p_password)';
begin
  for f in (
    select pg_get_functiondef(p.oid) as ddl
    from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.proname like 'pg_%' and 'p_password'=any(p.proargnames)
      and p.prosrc ~* comprobacion
  ) loop
    execute regexp_replace(f.ddl,comprobacion,E'\\1p_password is null or \\2','gi');
  end loop;
end;
$$;

create function public.pg_operaciones_equipo(p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  accion text := p_cambio->>'accion';
  usuario_nuevo text := lower(btrim(p_cambio->>'usuario'));
  nombre_nuevo text := btrim(p_cambio->>'nombre');
  clave_nueva text;
  cuenta_id bigint;
begin
  if admin.rol is distinct from 'plataforma'
    or not echo_privado.operaciones_acceso(admin,p_condominio)
    or not exists(select 1 from public.condominios c where c.id=p_condominio and c.codigo='M60') then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if accion='crear' then
    if coalesce(usuario_nuevo,'') !~ '^m60[.][a-z0-9][a-z0-9._-]{2,40}$'
      or coalesce(char_length(nombre_nuevo),0) not between 2 and 100 then
      return jsonb_build_object('ok',false,'error','Revisa el nombre y el usuario.');
    end if;
    if exists(select 1 from public.admins a where lower(a.user_id)=usuario_nuevo) then
      return jsonb_build_object('ok',false,'error','Ese usuario ya está registrado.');
    end if;
    clave_nueva := encode(extensions.gen_random_bytes(18),'hex');
    insert into echo_privado.operaciones_usuarios(condominio_id,usuario,nombre,password_hash,creado_por)
    values (p_condominio,usuario_nuevo,nombre_nuevo,
      extensions.crypt(clave_nueva,extensions.gen_salt('bf',8)),admin.user_id)
    on conflict (usuario) do nothing returning id into cuenta_id;
    if cuenta_id is null then return jsonb_build_object('ok',false,'error','Ese usuario ya está registrado.'); end if;
  elsif accion in ('revocar','restablecer') then
    if accion='restablecer' then clave_nueva := encode(extensions.gen_random_bytes(18),'hex'); end if;
    update echo_privado.operaciones_usuarios u
    set activo=(accion='restablecer'),
      password_hash=case when accion='restablecer' then
        extensions.crypt(clave_nueva,extensions.gen_salt('bf',8)) else u.password_hash end
    where u.condominio_id=p_condominio and u.usuario=usuario_nuevo
    returning u.id into cuenta_id;
    if cuenta_id is null then return jsonb_build_object('ok',false,'error','Ese usuario no pertenece a este condominio.'); end if;
  elsif p_cambio is not null then
    return jsonb_build_object('ok',false,'error','Operación inválida.');
  end if;
  return jsonb_build_object('ok',true,'usuario',usuario_nuevo,'clave',clave_nueva,
    'equipo',coalesce((select jsonb_agg(jsonb_build_object('usuario',u.usuario,'nombre',u.nombre,
      'activo',u.activo,'fecha',u.creado_at) order by u.creado_at desc)
      from echo_privado.operaciones_usuarios u where u.condominio_id=p_condominio),'[]'::jsonb));
end;
$$;

create function public.pg_operaciones_portafolio(p_user text,p_password text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
begin
  if admin.rol is distinct from 'plataforma' then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  return jsonb_build_object('ok',true,'condominios',coalesce((
    select jsonb_agg(to_jsonb(x) order by x.nombre) from (
      select c.id,c.codigo,c.nombre,
        (select count(*) from public.unidades u where u.condominio_id=c.id and u.activa) unidades,
        (select count(distinct p.clave) from echo_privado.operaciones_padron p where p.condominio_id=c.id) propietarios,
        (select count(*) from echo_privado.operaciones_solicitudes s where s.condominio_id=c.id and s.estado='pendiente') solicitudes,
        (select count(*) from echo_privado.operaciones_cargas a where a.condominio_id=c.id) cargas
      from public.condominios c where echo_privado.operaciones_acceso(admin,c.id)
    ) x
  ),'[]'::jsonb));
end;
$$;

create table echo_privado.operaciones_registros_locales (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  tipo text not null check (tipo in ('incidencia','gasto')),
  fecha date not null,
  titulo text not null,
  referencia text,
  descripcion text,
  estado text check (estado in ('pendiente','en_proceso','resuelta')),
  monto numeric(12,2) check (monto>0),
  creado_at timestamptz not null default now(),
  creado_por text not null,
  actualizado_at timestamptz,
  actualizado_por text,
  check ((tipo='incidencia' and estado is not null and monto is null)
    or (tipo='gasto' and estado is null and monto is not null))
);
create index operaciones_registros_locales_idx
  on echo_privado.operaciones_registros_locales(condominio_id,tipo,fecha desc,id desc);
alter table echo_privado.operaciones_registros_locales enable row level security;
revoke all on echo_privado.operaciones_registros_locales from public, anon, authenticated;

create function public.pg_operaciones_locales(p_user text,p_password text,p_condominio bigint,p_tipo text,p_cambio jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  accion text := p_cambio->>'accion';
  nuevo_titulo text := nullif(btrim(p_cambio->>'titulo'),'');
  nueva_referencia text := nullif(btrim(p_cambio->>'referencia'),'');
  nueva_descripcion text := nullif(btrim(p_cambio->>'descripcion'),'');
  nuevo_estado text := p_cambio->>'estado';
  nueva_fecha date;
  nuevo_monto numeric(12,2);
  hoy date := (now() at time zone 'America/Cancun')::date;
begin
  if not echo_privado.operaciones_acceso(admin,p_condominio)
    or not exists(select 1 from public.condominios c where c.id=p_condominio and c.codigo='M60') then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if p_tipo is null or p_tipo not in ('incidencia','gasto') then
    return jsonb_build_object('ok',false,'error','Sección inválida.');
  end if;

  if accion='crear' then
    begin
      nueva_fecha := (p_cambio->>'fecha')::date;
      if p_tipo='gasto' then nuevo_monto := (p_cambio->>'monto')::numeric(12,2); end if;
    exception when invalid_text_representation or datetime_field_overflow
      or invalid_datetime_format or numeric_value_out_of_range then
      return jsonb_build_object('ok',false,'error','Revisa la fecha y el importe.');
    end;
    if coalesce(char_length(nuevo_titulo),0) not between 2 and 120
      or char_length(nueva_referencia)>120 or char_length(nueva_descripcion)>1500
      or nueva_fecha is null or nueva_fecha not between date '2000-01-01' and hoy
      or (p_tipo='gasto' and (nuevo_monto is null or nuevo_monto<=0 or nuevo_monto='NaN'::numeric)) then
      return jsonb_build_object('ok',false,'error','Revisa el concepto, la fecha y los datos capturados.');
    end if;
    insert into echo_privado.operaciones_registros_locales(condominio_id,tipo,fecha,titulo,referencia,
      descripcion,estado,monto,creado_por)
    values(p_condominio,p_tipo,nueva_fecha,nuevo_titulo,nueva_referencia,nueva_descripcion,
      case when p_tipo='incidencia' then 'pendiente' end,nuevo_monto,admin.user_id);
  elsif accion='estado' and p_tipo='incidencia' then
    if coalesce(nuevo_estado,'') not in ('pendiente','en_proceso','resuelta')
      or coalesce(p_cambio->>'id','') !~ '^[0-9]{1,15}$' then
      return jsonb_build_object('ok',false,'error','El estado seleccionado es inválido.');
    end if;
    update echo_privado.operaciones_registros_locales r
    set estado=nuevo_estado,actualizado_at=now(),actualizado_por=admin.user_id
    where r.id=(p_cambio->>'id')::bigint and r.condominio_id=p_condominio and r.tipo=p_tipo;
    if not found then return jsonb_build_object('ok',false,'error','No encontramos esa incidencia.'); end if;
  elsif p_cambio is not null then
    return jsonb_build_object('ok',false,'error','Operación inválida.');
  end if;

  return jsonb_build_object('ok',true,'hoy',hoy,
    'resumen',jsonb_build_object(
      'incidencias',(select count(*) from echo_privado.operaciones_registros_locales r
        where r.condominio_id=p_condominio and r.tipo='incidencia' and r.estado<>'resuelta'),
      'gastos_mes',(select coalesce(sum(r.monto),0) from echo_privado.operaciones_registros_locales r
        where r.condominio_id=p_condominio and r.tipo='gasto' and r.fecha>=date_trunc('month',hoy)::date)),
    'registros',coalesce((
      select jsonb_agg(to_jsonb(r) - 'condominio_id' order by r.fecha desc,r.id desc)
      from (select * from echo_privado.operaciones_registros_locales l
        where l.condominio_id=p_condominio and l.tipo=p_tipo order by l.fecha desc,l.id desc limit 150) r
    ),'[]'::jsonb));
end;
$$;

revoke all on function public.pg_operaciones_equipo(text,text,bigint,jsonb),
  public.pg_operaciones_portafolio(text,text),
  public.pg_operaciones_locales(text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.pg_operaciones_equipo(text,text,bigint,jsonb),
  public.pg_operaciones_portafolio(text,text),
  public.pg_operaciones_locales(text,text,bigint,text,jsonb) to anon, authenticated;
