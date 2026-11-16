create schema if not exists echo_privado;

insert into public.condominios(codigo,nombre,activo)
values ('M60','Manzana 60',true)
on conflict (codigo) do nothing;

create table echo_privado.operaciones_propietarios (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  clave text not null,
  nombre text not null,
  email text,
  telefono text,
  whatsapp text,
  unique (condominio_id, clave)
);
create table echo_privado.operaciones_titularidades (
  propietario_id bigint not null references echo_privado.operaciones_propietarios(id),
  unidad_id bigint not null references public.unidades(id),
  primary key (propietario_id, unidad_id)
);
create table echo_privado.operaciones_cargas (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  archivo text not null,
  huella text not null,
  filas integer not null,
  registrado_por text not null,
  creado_at timestamptz not null default now(),
  unique (condominio_id, huella)
);
create table echo_privado.operaciones_solicitudes (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  nombre text not null,
  edificio text not null,
  unidad text not null,
  email text,
  telefono text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  creado_at timestamptz not null default now(),
  revisado_at timestamptz,
  revisado_por text
);
alter table echo_privado.operaciones_propietarios enable row level security;
alter table echo_privado.operaciones_titularidades enable row level security;
alter table echo_privado.operaciones_cargas enable row level security;
alter table echo_privado.operaciones_solicitudes enable row level security;
revoke all on echo_privado.operaciones_propietarios, echo_privado.operaciones_titularidades,
  echo_privado.operaciones_cargas, echo_privado.operaciones_solicitudes from public, anon, authenticated;
create index operaciones_solicitudes_condominio_fecha_idx
  on echo_privado.operaciones_solicitudes(condominio_id, creado_at desc);
create unique index operaciones_solicitudes_pendientes_idx
  on echo_privado.operaciones_solicitudes(condominio_id, edificio, unidad, lower(nombre))
  where estado = 'pendiente';

create function echo_privado.operaciones_admin(p_user text, p_password text)
returns public.admins language sql stable set search_path = pg_catalog as $$
  select a from public.admins a
  where a.user_id = p_user and p_password <> '' and a.password_hash is not null
    and extensions.crypt(p_password,a.password_hash) = a.password_hash;
$$;

create function echo_privado.operaciones_acceso(a public.admins, p_condominio bigint)
returns boolean language sql stable set search_path = pg_catalog as $$
  select a.id is not null and exists (
    select 1 from public.condominios c
    where c.id = p_condominio and c.activo and c.codigo is distinct from 'APP-REVIEW'
      and (a.rol = 'plataforma' or c.id = a.condominio_id
        or c.id = any(a.condominios_permitidos)
        or exists (select 1 from public.admin_condominios ac where ac.admin_user = a.user_id and ac.condominio_id = c.id))
  );
$$;

create function public.pg_operaciones_condominios(p_user text, p_password text, p_nuevo jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  nuevo_id bigint;
  nuevo_codigo text := upper(btrim(p_nuevo->>'codigo'));
  nuevo_nombre text := btrim(p_nuevo->>'nombre');
begin
  if admin.id is null then return jsonb_build_object('ok',false,'error','Usuario o contraseña incorrectos.'); end if;
  if p_nuevo is not null then
    if admin.rol is distinct from 'plataforma' then
      return jsonb_build_object('ok',false,'error','Tu usuario no puede crear condominios.');
    end if;
    if coalesce(nuevo_codigo,'') !~ '^[A-Z0-9][A-Z0-9-]{0,19}$'
       or coalesce(char_length(nuevo_nombre),0) not between 2 and 100 then
      return jsonb_build_object('ok',false,'error','Revisa el código y el nombre del condominio.');
    end if;
    insert into public.condominios(codigo,nombre,activo) values (nuevo_codigo,nuevo_nombre,true)
    on conflict (codigo) do nothing returning id into nuevo_id;
    if nuevo_id is null then return jsonb_build_object('ok',false,'error','Ese código ya está registrado.'); end if;
  end if;
  return jsonb_build_object('ok',true,'nuevo_id',nuevo_id,'puede_crear',admin.rol='plataforma',
    'condominios', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nombre',c.nombre) order by c.id)
      from public.condominios c where echo_privado.operaciones_acceso(admin,c.id)
    ),'[]'::jsonb));
end;
$$;

create view echo_privado.operaciones_padron as
with existentes as (
  select u.condominio_id, u.id as unidad_id, u.edificio, u.numero as unidad,
    'ECHO-' || upper(replace(p.id::text,'-','')) as clave,
    coalesce(h.nuevo,nullif(btrim(r.nombre_completo),''),p.nombre_completo,'') as nombre,
    coalesce(nullif(btrim(r.email),''),p.email,p.email_sugerido) as email,
    coalesce(nullif(btrim(r.telefono),''),p.telefono) as telefono,
    coalesce(nullif(btrim(r.whatsapp),''),p.whatsapp) as whatsapp
  from public.membresias m
  join public.unidades u on u.id=m.unidad_id and u.activa
  join public.perfiles p on p.id=m.perfil_id
  left join public.residentes r on r.id_residente=p.id_residente_legacy and r.condominio_id=u.condominio_id
  left join lateral (
    select c.nuevo from echo_privado.cambios_propietario c where c.id_residente=r.id_residente
    order by c.id desc limit 1
  ) h on true
  where m.activa and m.rol='propietario'
), importados as (
  select u.condominio_id, u.id as unidad_id, u.edificio, u.numero as unidad,
    p.clave,p.nombre,p.email,p.telefono,p.whatsapp
  from echo_privado.operaciones_propietarios p
  join echo_privado.operaciones_titularidades t on t.propietario_id=p.id
  join public.unidades u on u.id=t.unidad_id and u.condominio_id=p.condominio_id and u.activa
)
select coalesce(i.condominio_id,e.condominio_id) as condominio_id,
  coalesce(i.unidad_id,e.unidad_id) as unidad_id,
  coalesce(i.edificio,e.edificio) as edificio, coalesce(i.unidad,e.unidad) as unidad,
  coalesce(i.clave,e.clave) as clave, coalesce(i.nombre,e.nombre) as nombre,
  coalesce(i.email,e.email) as email, coalesce(i.telefono,e.telefono) as telefono,
  coalesce(i.whatsapp,e.whatsapp) as whatsapp
from existentes e full join importados i
  on i.condominio_id=e.condominio_id and i.unidad_id=e.unidad_id and i.clave=e.clave;
revoke all on echo_privado.operaciones_padron from public, anon, authenticated;

create function echo_privado.operaciones_guardar_padron(p_condominio bigint,p_filas jsonb)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  insert into public.unidades(condominio_id,edificio,numero,identificador,cuota_mensual)
  select distinct c.id, f.edificio, f.unidad, f.edificio || '-' || f.unidad, c.cuota_ordinaria
  from jsonb_to_recordset(p_filas) f(edificio text,unidad text)
  join public.condominios c on c.id=p_condominio
  where not exists (
    select 1 from public.unidades u where u.condominio_id=c.id
      and upper(btrim(u.edificio))=f.edificio and upper(btrim(u.numero))=f.unidad
  )
  on conflict (condominio_id,edificio,numero) do nothing;

  insert into echo_privado.operaciones_propietarios(condominio_id,clave,nombre,email,telefono,whatsapp)
  select p_condominio,f.clave,max(f.nombre),max(nullif(f.email,'')),
    max(nullif(f.telefono,'')),max(nullif(f.whatsapp,''))
  from jsonb_to_recordset(p_filas) f(clave text,nombre text,email text,telefono text,whatsapp text)
  group by f.clave
  on conflict (condominio_id,clave) do update set
    nombre=excluded.nombre,
    email=coalesce(excluded.email,operaciones_propietarios.email),
    telefono=coalesce(excluded.telefono,operaciones_propietarios.telefono),
    whatsapp=coalesce(excluded.whatsapp,operaciones_propietarios.whatsapp);

  insert into echo_privado.operaciones_titularidades(propietario_id,unidad_id)
  select p.id,u.id
  from jsonb_to_recordset(p_filas) f(clave text,edificio text,unidad text)
  join echo_privado.operaciones_propietarios p on p.condominio_id=p_condominio and p.clave=f.clave
  join public.unidades u on u.condominio_id=p_condominio and u.activa
    and upper(btrim(u.edificio))=f.edificio and upper(btrim(u.numero))=f.unidad
  on conflict do nothing;
end;
$$;

create function public.pg_operaciones_padron(
  p_user text,p_password text,p_condominio bigint,p_archivo jsonb default null,p_revision jsonb default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  carga_id bigint;
  filas jsonb;
  problemas jsonb;
  solicitud echo_privado.operaciones_solicitudes;
  titular text;
begin
  if not echo_privado.operaciones_acceso(admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;

  if p_archivo is not null and p_revision is not null then
    return jsonb_build_object('ok',false,'error','Envía una sola operación a la vez.');
  end if;
  if p_archivo is not null or p_revision is not null then
    -- Serializa cambios del padrón del mismo condominio, incluso si llegan desde dos pestañas.
    perform 1 from public.condominios where id=p_condominio for update;
  end if;

  if p_archivo is not null then
    filas := p_archivo->'filas';
    if jsonb_typeof(filas) is distinct from 'array' or coalesce(char_length(p_archivo->>'nombre'),0) not between 1 and 180
       or coalesce(p_archivo->>'huella','') !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('ok',false,'error','No se pudo leer el archivo.');
    end if;
    if jsonb_array_length(filas) not between 1 and 2000 then
      return jsonb_build_object('ok',false,'error','El archivo debe contener entre 1 y 2,000 filas.');
    end if;
    if exists (select 1 from jsonb_array_elements(filas) f where jsonb_typeof(f) <> 'object') then
      return jsonb_build_object('ok',false,'error','Las filas del archivo deben seguir la plantilla.');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('fila',f.fila,'mensaje',observacion) order by f.fila),'[]'::jsonb)
    into problemas
    from (
      select t.*,
        case when t.manzana is distinct from (select c.codigo from public.condominios c where c.id=p_condominio)
          then 'La fila pertenece a otro condominio.'
          when t.clave !~ '^[A-Z0-9][A-Z0-9_-]{0,59}$' then 'Clave de propietario inválida.'
          when t.clave ~ '^REGISTRO-' and not exists (
            select 1 from echo_privado.operaciones_propietarios x where x.condominio_id=p_condominio and x.clave=t.clave
          ) then 'La clave de registro pertenece a otro padrón.'
          when t.clave ~ '^ECHO-' and not exists (
            select 1 from echo_privado.operaciones_padron x where x.condominio_id=p_condominio and x.clave=t.clave
              and upper(btrim(x.edificio))=t.edificio and upper(btrim(x.unidad))=t.unidad
          ) then 'La clave Echo no corresponde a esta unidad del condominio.'
          when char_length(t.nombre) not between 2 and 150 then 'Falta un nombre válido.'
          when t.edificio !~ '^[[:alnum:]][[:alnum:] _/-]{0,29}$'
            or t.unidad !~ '^[[:alnum:]][[:alnum:] _/-]{0,29}$' then 'Revisa el edificio y la unidad.'
          when t.email <> '' and (char_length(t.email)>254 or t.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
            then 'Correo inválido.'
          when char_length(t.telefono)>30 or char_length(t.whatsapp)>30 then 'Teléfono o WhatsApp demasiado largo.'
          when (select count(*) from public.unidades u where u.condominio_id=p_condominio
            and upper(btrim(u.edificio))=t.edificio and upper(btrim(u.numero))=t.unidad) > 1
            then 'Hay más de una unidad con este edificio y número.'
          when exists (select 1 from public.unidades u where u.condominio_id=p_condominio and not u.activa
            and upper(btrim(u.edificio))=t.edificio and upper(btrim(u.numero))=t.unidad)
            then 'La unidad está inactiva.'
        end as observacion
      from (
        select ord as fila, x->>'manzana' as manzana, coalesce(x->>'clave','') as clave, coalesce(x->>'nombre','') as nombre,
          coalesce(x->>'edificio','') as edificio, coalesce(x->>'unidad','') as unidad,
          coalesce(x->>'email','') as email, coalesce(x->>'telefono','') as telefono,
          coalesce(x->>'whatsapp','') as whatsapp
        from jsonb_array_elements(filas) with ordinality a(x,ord)
      ) t
    ) f where observacion is not null;

    if jsonb_array_length(problemas)>0 then
      return jsonb_build_object('ok',false,'error','Corrige las filas indicadas.','problemas',problemas);
    end if;
    if exists (
      select 1 from jsonb_to_recordset(filas) f(clave text,edificio text,unidad text)
      group by clave,edificio,unidad having count(*)>1
    ) then return jsonb_build_object('ok',false,'error','El archivo repite una clave con la misma unidad.'); end if;
    if exists (
      select 1 from jsonb_to_recordset(filas) f(clave text,nombre text,email text,telefono text,whatsapp text)
      group by clave having count(distinct nombre)>1 or count(distinct nullif(email,''))>1
        or count(distinct nullif(telefono,''))>1 or count(distinct nullif(whatsapp,''))>1
    ) then return jsonb_build_object('ok',false,'error','Una misma clave tiene distintos nombres o datos de contacto.'); end if;

    insert into echo_privado.operaciones_cargas(condominio_id,archivo,huella,filas,registrado_por)
    values (p_condominio,p_archivo->>'nombre',p_archivo->>'huella',jsonb_array_length(filas),admin.user_id)
    on conflict (condominio_id,huella) do nothing returning id into carga_id;
    if carga_id is null then return jsonb_build_object('ok',false,'error','Este archivo ya se importó.'); end if;
    perform echo_privado.operaciones_guardar_padron(p_condominio,filas);
  end if;

  if p_revision is not null then
    if coalesce(p_revision->>'id','') !~ '^[0-9]{1,16}$' or coalesce(p_revision->>'estado','') not in ('aprobada','rechazada') then
      return jsonb_build_object('ok',false,'error','Revisión inválida.');
    end if;
    select * into solicitud from echo_privado.operaciones_solicitudes
    where id=(p_revision->>'id')::bigint and condominio_id=p_condominio and estado='pendiente'
    for update;
    if not found then return jsonb_build_object('ok',false,'error','La solicitud ya no está pendiente.'); end if;
    if p_revision->>'estado'='aprobada' then
      if (select count(*) from public.unidades u where u.condominio_id=p_condominio and u.activa
        and upper(btrim(u.edificio))=solicitud.edificio and upper(btrim(u.numero))=solicitud.unidad) > 1
        or exists (select 1 from public.unidades u where u.condominio_id=p_condominio and not u.activa
          and upper(btrim(u.edificio))=solicitud.edificio and upper(btrim(u.numero))=solicitud.unidad) then
        return jsonb_build_object('ok',false,'error','Revisa el registro de esta unidad antes de aprobar.');
      end if;

      select case when count(distinct x.clave)=1 then min(x.clave) end into titular
      from echo_privado.operaciones_padron x
      where x.condominio_id=p_condominio and upper(btrim(x.edificio))=solicitud.edificio
        and upper(btrim(x.unidad))=solicitud.unidad and lower(btrim(x.nombre))=lower(solicitud.nombre);
      if titular is null and exists (
        select 1 from echo_privado.operaciones_padron x
        where x.condominio_id=p_condominio and upper(btrim(x.edificio))=solicitud.edificio
          and upper(btrim(x.unidad))=solicitud.unidad
      ) and (p_revision->>'copropietario') is distinct from 'true' then
        return jsonb_build_object('ok',false,'error','Esta unidad ya tiene otra ficha. Confirma si deseas agregar una copropiedad.',
          'copropietario',true);
      end if;
      perform echo_privado.operaciones_guardar_padron(p_condominio,jsonb_build_array(jsonb_build_object(
        'clave',coalesce(titular,'REGISTRO-' || solicitud.id), 'nombre',solicitud.nombre,
        'edificio',solicitud.edificio,'unidad',solicitud.unidad,'email',solicitud.email,'telefono',solicitud.telefono
      )));
    end if;
    update echo_privado.operaciones_solicitudes
    set estado=p_revision->>'estado', revisado_at=now(), revisado_por=admin.user_id where id=solicitud.id;
  end if;

  return jsonb_build_object('ok',true,'carga_id',carga_id,
    'unidades',(select count(*) from public.unidades where condominio_id=p_condominio and activa),
    'padron',coalesce((select jsonb_agg(to_jsonb(x) - 'condominio_id' - 'unidad_id' order by x.nombre,x.edificio,x.unidad)
      from echo_privado.operaciones_padron x where x.condominio_id=p_condominio),'[]'::jsonb),
    'solicitudes',coalesce((select jsonb_agg(to_jsonb(s) - 'condominio_id' order by s.creado_at desc)
      from echo_privado.operaciones_solicitudes s where s.condominio_id=p_condominio and s.estado='pendiente'),'[]'::jsonb),
    'cargas',coalesce((select jsonb_agg(to_jsonb(c) - 'huella' - 'condominio_id' order by c.creado_at desc)
      from (select * from echo_privado.operaciones_cargas where condominio_id=p_condominio
        order by creado_at desc limit 30) c),'[]'::jsonb));
end;
$$;

create function public.registrar_propietario_m60(
  p_nombre text,p_edificio text,p_unidad text,p_email text default null,p_telefono text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_condominio bigint;
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre,''),'[[:space:]]+',' ','g'));
  v_edificio text := upper(btrim(coalesce(p_edificio,'')));
  v_unidad text := upper(btrim(coalesce(p_unidad,'')));
  v_email text := nullif(lower(btrim(p_email)),'');
  v_telefono text := nullif(btrim(p_telefono),'');
begin
  if char_length(v_nombre) not between 2 and 150 or v_nombre !~ '[[:alpha:]]'
     or v_edificio !~ '^[[:alnum:]][[:alnum:] _/-]{0,29}$' or v_unidad !~ '^[[:alnum:]][[:alnum:] _/-]{0,29}$'
     or (v_email is not null and (char_length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or (v_telefono is not null and (char_length(v_telefono)>30 or regexp_replace(v_telefono,'[^0-9]','','g') !~ '^[0-9]{7,15}$')) then
    return jsonb_build_object('ok',false,'error','Revisa tu nombre, edificio, unidad y datos de contacto.');
  end if;
  select id into v_condominio from public.condominios where codigo='M60' and activo;
  if v_condominio is null then
    return jsonb_build_object('ok',false,'error','El registro está temporalmente cerrado.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('registro_propietario_m60',0));
  if (select count(*) from echo_privado.operaciones_solicitudes s
      where s.condominio_id=v_condominio and s.creado_at > now() - interval '10 minutes') >= 150 then
    return jsonb_build_object('ok',false,'error','Hay muchas solicitudes en este momento. Intenta de nuevo en unos minutos.');
  end if;
  if not exists (select 1 from echo_privado.operaciones_solicitudes s
      where s.condominio_id=v_condominio and s.edificio=v_edificio and s.unidad=v_unidad and lower(s.nombre)=lower(v_nombre)
        and s.estado='aprobada' and s.revisado_at > now() - interval '24 hours') then
    insert into echo_privado.operaciones_solicitudes(condominio_id,nombre,edificio,unidad,email,telefono)
    values (v_condominio,v_nombre,v_edificio,v_unidad,v_email,v_telefono)
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

create function public.pg_operaciones_archivos(p_user text,p_password text,p_condominio bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  archivos jsonb;
  mensual jsonb;
  cargas jsonb;
begin
  if not echo_privado.operaciones_acceso(admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.fecha desc nulls last, f.tipo, f.folio),'[]'::jsonb)
  into archivos from (
    select 'Documento' as tipo,d.id::text as folio,d.fecha_documento as fecha,
      d.titulo as concepto,d.categoria as categoria,null::text as unidad,
      case when d.publicado then 'Publicado' else 'Interno' end as estado,
      null::numeric as monto,'MXN'::text as moneda,null::text as referencia
    from public.documentos d where d.condominio_id=p_condominio
    union all
    select 'Comprobante de pago',rc.folio::text,rc.fecha,
      (select string_agg(j->>'concepto',' · ') from jsonb_array_elements(
        case when jsonb_typeof(rc.conceptos)='array' then rc.conceptos else '[]'::jsonb end) j),
      null, rc.ident,rc.estado,rc.total,'MXN',null
    from public.recibos rc join public.residentes r using(id_residente)
    where r.condominio_id=p_condominio
    union all
    select 'Estado sin adeudo',c.folio::text,c.fecha,'Estado sin adeudo',null,c.ident,c.estado,null,'MXN',null
    from public.constancias c where c.condominio_id=p_condominio
    union all
    select 'Recibo de servicio',s.id::text,s.fecha_vencimiento,s.periodo,s.tipo,
      u.identificador,case when s.pagado then 'Pagado' else 'Pendiente' end,s.monto,'MXN',
      case when s.archivo_url ~* '^https?://' then s.archivo_url end
    from public.recibos_servicios s left join public.unidades u on u.id=s.unidad_id and u.condominio_id=p_condominio
    where s.condominio_id=p_condominio
  ) f;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.periodo),'[]'::jsonb) into mensual
  from (
    select to_char(p.periodo,'YYYY-MM') as periodo,count(*) as registros,
      count(*) filter(where p.estado='pagado') as pagados,
      count(*) filter(where p.estado='pendiente') as pendientes,
      coalesce(sum(p.monto) filter(where p.estado='pagado'),0) as total_pagado,
      coalesce(sum(p.monto) filter(where p.estado='pendiente'),0) as total_pendiente
    from public.pagos p where p.condominio_id=p_condominio group by 1
  ) m;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.fecha desc, c.folio desc),'[]'::jsonb)
    into cargas from (
      select id as folio,to_char(creado_at at time zone 'America/Cancun','YYYY-MM-DD HH24:MI') as fecha,
        archivo,filas,registrado_por
      from echo_privado.operaciones_cargas where condominio_id=p_condominio
    ) c;

  return jsonb_build_object('ok',true,'archivos',archivos,'mensual',mensual,'cargas',cargas,
    'fecha',to_char(now() at time zone 'America/Cancun','YYYY-MM-DD'));
end;
$$;

revoke all on function echo_privado.operaciones_admin(text,text),
  echo_privado.operaciones_acceso(public.admins,bigint),
  echo_privado.operaciones_guardar_padron(bigint,jsonb) from public, anon, authenticated;
revoke all on function public.pg_operaciones_condominios(text,text,jsonb),
  public.pg_operaciones_padron(text,text,bigint,jsonb,jsonb),
  public.pg_operaciones_archivos(text,text,bigint),
  public.registrar_propietario_m60(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.pg_operaciones_condominios(text,text,jsonb),
  public.pg_operaciones_padron(text,text,bigint,jsonb,jsonb),
  public.pg_operaciones_archivos(text,text,bigint),
  public.registrar_propietario_m60(text,text,text,text,text) to anon, authenticated;
