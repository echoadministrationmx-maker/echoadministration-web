create table echo_privado.operaciones_rentas (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  edificio text not null,
  unidad text not null,
  titulo text not null,
  contacto text not null,
  email text,
  telefono text,
  plazos text[] not null check (cardinality(plazos) between 1 and 3 and plazos <@ array['corto','mediano','largo']),
  situacion text not null check (situacion in ('disponible','rentado')),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','archivada')),
  precio numeric(12,2),
  periodo_precio text check (periodo_precio in ('noche','semana','mes')),
  fecha_disponible date,
  habitaciones integer,
  banos numeric(3,1),
  descripcion text,
  enlace text,
  creado_at timestamptz not null default now(),
  revisado_at timestamptz,
  revisado_por text,
  check ((precio is null)=(periodo_precio is null))
);
create index operaciones_rentas_busqueda_idx on echo_privado.operaciones_rentas(condominio_id,creado_at desc);
create unique index operaciones_rentas_unidad_activa_idx on echo_privado.operaciones_rentas(condominio_id,edificio,unidad) where estado='aprobada';

create table echo_privado.operaciones_rentas_fotos (
  renta_id bigint references echo_privado.operaciones_rentas(id) on delete cascade,
  orden smallint check (orden between 1 and 4),
  datos bytea not null check (octet_length(datos) between 4 and 160000),
  primary key(renta_id,orden)
);
create table echo_privado.operaciones_negocios (
  id bigint generated always as identity primary key,
  nombre text not null,
  categoria text not null,
  ciudad text not null,
  contacto text not null,
  email text,
  telefono text,
  direccion text,
  enlace text,
  beneficio text not null,
  condiciones text,
  vigencia date,
  estado text not null default 'pendiente' check (estado in ('pendiente','contactado','aceptado','rechazado')),
  creado_at timestamptz not null default now(),
  revisado_at timestamptz,
  revisado_por text
);
create index operaciones_negocios_fecha_idx on echo_privado.operaciones_negocios(creado_at desc);
alter table echo_privado.operaciones_rentas enable row level security;
alter table echo_privado.operaciones_rentas_fotos enable row level security;
alter table echo_privado.operaciones_negocios enable row level security;
revoke all on echo_privado.operaciones_rentas,echo_privado.operaciones_rentas_fotos,echo_privado.operaciones_negocios from public,anon,authenticated;

create function echo_privado.contacto_registro_valido(v_email text,v_tel text)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select (v_email is not null or v_tel is not null)
    and (v_email is null or (char_length(v_email)<=254 and v_email~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    and (v_tel is null or (char_length(v_tel)<=30 and regexp_replace(v_tel,'[^0-9]','','g')~'^[0-9]{7,15}$'));
$$;

create function public.echo_registrar_departamento(p_condominio text,p_datos jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_condominio bigint;
  v_id bigint;
  v_edificio text := upper(regexp_replace(btrim(coalesce(p_datos->>'edificio','')),'[[:space:]]+',' ','g'));
  v_unidad text := upper(regexp_replace(btrim(coalesce(p_datos->>'unidad','')),'[[:space:]]+',' ','g'));
  v_titulo text := btrim(coalesce(p_datos->>'titulo',''));
  v_contacto text := btrim(coalesce(p_datos->>'contacto',''));
  v_email text := nullif(lower(btrim(p_datos->>'email')),'');
  v_tel text := nullif(btrim(p_datos->>'telefono'),'');
  v_situacion text := coalesce(p_datos->>'situacion','');
  v_descripcion text := nullif(btrim(p_datos->>'descripcion'),'');
  v_enlace text := nullif(btrim(p_datos->>'enlace'),'');
  v_periodo text := nullif(p_datos->>'periodo_precio','');
  v_plazos text[];
  v_fotos jsonb := coalesce(p_datos->'fotos','[]'::jsonb);
  v_foto text;
  v_foto_bytes bytea;
  v_precio numeric(12,2);
  v_habitaciones integer;
  v_banos numeric(3,1);
  v_fecha date;
begin
  select c.id into v_condominio from public.condominios c
  where c.activo and c.codigo=upper(btrim(p_condominio)) and c.codigo in ('M60','M80');
  if v_condominio is null or jsonb_typeof(p_datos->'plazos') is distinct from 'array'
    or jsonb_typeof(v_fotos) is distinct from 'array'
    or char_length(v_edificio) not between 1 and 40 or char_length(v_unidad) not between 1 and 40
    or char_length(v_titulo) not between 2 and 120 or char_length(v_contacto) not between 2 and 120
    or v_situacion not in ('disponible','rentado')
    or not echo_privado.contacto_registro_valido(v_email,v_tel)
    or char_length(v_descripcion)>1500 or (v_enlace is not null and (char_length(v_enlace)>600 or v_enlace !~ '^https?://[^[:space:]]+$')) then
    return jsonb_build_object('ok',false,'error','Revisa la manzana, el departamento y los datos de contacto.');
  end if;
  if jsonb_array_length(v_fotos)>4 or jsonb_array_length(p_datos->'plazos') not between 1 and 3 then
    return jsonb_build_object('ok',false,'error','Elige de uno a tres plazos y sube hasta cuatro fotos.');
  end if;
  select array_agg(distinct x order by x) into v_plazos from jsonb_array_elements_text(p_datos->'plazos') f(x);
  if array_position(v_plazos,null) is not null or not (v_plazos <@ array['corto','mediano','largo']) then
    return jsonb_build_object('ok',false,'error','Elige uno o más plazos de renta.');
  end if;
  begin
    v_precio:=nullif(p_datos->>'precio','')::numeric(12,2);
    v_habitaciones:=nullif(p_datos->>'habitaciones','')::integer;
    v_banos:=nullif(p_datos->>'banos','')::numeric(3,1);
    v_fecha:=nullif(p_datos->>'fecha_disponible','')::date;
    for v_foto in select jsonb_array_elements_text(v_fotos) loop
      if v_foto is null or char_length(v_foto)>213336 or v_foto !~ '^[a-zA-Z0-9+/]+={0,2}$' then
        return jsonb_build_object('ok',false,'error','Una foto excede el tamaño permitido o tiene un formato inválido.');
      end if;
      v_foto_bytes:=decode(v_foto,'base64');
      if octet_length(v_foto_bytes) not between 4 and 160000
        or substring(v_foto_bytes from 1 for 3)<>decode('ffd8ff','hex')
        or substring(v_foto_bytes from octet_length(v_foto_bytes)-1)<>decode('ffd9','hex') then
        return jsonb_build_object('ok',false,'error','Una de las fotos tiene un formato inválido.');
      end if;
    end loop;
  exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('ok',false,'error','Revisa la fecha, el precio, las habitaciones y las fotos.');
  end;
  if (v_precio is null)<>(v_periodo is null) or (v_periodo is not null and v_periodo not in ('noche','semana','mes'))
    or (v_precio is not null and (v_precio<=0 or v_precio='NaN'::numeric))
    or v_habitaciones not between 0 and 25 or (v_banos is not null and (v_banos not between 0 and 25 or v_banos='NaN'::numeric))
    or v_fecha not between date '2000-01-01' and date '2100-12-31' then
    return jsonb_build_object('ok',false,'error','Revisa el precio, su periodo y las características del departamento.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('echo_registrar_departamento',0));
  if exists(select 1 from echo_privado.operaciones_rentas r where r.condominio_id=v_condominio
    and r.edificio=v_edificio and r.unidad=v_unidad and r.estado='pendiente'
    and r.email is not distinct from v_email and r.telefono is not distinct from v_tel
    and r.creado_at>now()-interval '24 hours') then return jsonb_build_object('ok',true); end if;
  if (select count(*) from echo_privado.operaciones_rentas where creado_at>now()-interval '10 minutes')>=120 then
    return jsonb_build_object('ok',false,'error','Hay muchas solicitudes en este momento. Intenta más tarde.');
  end if;
  insert into echo_privado.operaciones_rentas(condominio_id,edificio,unidad,titulo,contacto,email,telefono,plazos,situacion,
    precio,periodo_precio,fecha_disponible,habitaciones,banos,descripcion,enlace)
  values(v_condominio,v_edificio,v_unidad,v_titulo,v_contacto,v_email,v_tel,v_plazos,v_situacion,
    v_precio,v_periodo,v_fecha,v_habitaciones,v_banos,v_descripcion,v_enlace) returning id into v_id;
  insert into echo_privado.operaciones_rentas_fotos(renta_id,orden,datos)
  select v_id,n,decode(x,'base64') from jsonb_array_elements_text(v_fotos) with ordinality f(x,n);
  return jsonb_build_object('ok',true);
end;
$$;

create function public.echo_registrar_negocio(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_nombre text := btrim(coalesce(p_datos->>'nombre',''));
  v_categoria text := btrim(coalesce(p_datos->>'categoria',''));
  v_ciudad text := btrim(coalesce(p_datos->>'ciudad',''));
  v_contacto text := btrim(coalesce(p_datos->>'contacto',''));
  v_email text := nullif(lower(btrim(p_datos->>'email')),'');
  v_tel text := nullif(btrim(p_datos->>'telefono'),'');
  v_direccion text := nullif(btrim(p_datos->>'direccion'),'');
  v_enlace text := nullif(btrim(p_datos->>'enlace'),'');
  v_beneficio text := btrim(coalesce(p_datos->>'beneficio',''));
  v_condiciones text := nullif(btrim(p_datos->>'condiciones'),'');
  v_vigencia date;
begin
  begin
    v_vigencia:=nullif(p_datos->>'vigencia','')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok',false,'error','La fecha de vigencia no es válida.');
  end;
  if char_length(v_nombre) not between 2 and 120 or char_length(v_categoria) not between 2 and 70
    or char_length(v_ciudad) not between 2 and 120 or char_length(v_contacto) not between 2 and 120
    or char_length(v_beneficio) not between 3 and 500 or char_length(v_condiciones)>1200
    or char_length(v_direccion)>240 or (v_enlace is not null and (char_length(v_enlace)>600 or v_enlace !~ '^https?://[^[:space:]]+$'))
    or not echo_privado.contacto_registro_valido(v_email,v_tel)
    or v_vigencia not between (now() at time zone 'America/Cancun')::date and date '2100-12-31' then
    return jsonb_build_object('ok',false,'error','Revisa los datos de contacto, el beneficio y la vigencia.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('echo_registrar_negocio',0));
  if exists(select 1 from echo_privado.operaciones_negocios n
    where lower(n.nombre)=lower(v_nombre) and lower(n.ciudad)=lower(v_ciudad)
      and n.email is not distinct from v_email and n.telefono is not distinct from v_tel
      and n.creado_at>now()-interval '24 hours') then return jsonb_build_object('ok',true); end if;
  if (select count(*) from echo_privado.operaciones_negocios where creado_at>now()-interval '10 minutes')>=120 then
    return jsonb_build_object('ok',false,'error','Hay muchas propuestas en este momento. Intenta más tarde.');
  end if;
  insert into echo_privado.operaciones_negocios(nombre,categoria,ciudad,contacto,email,telefono,direccion,enlace,beneficio,condiciones,vigencia)
  values(v_nombre,v_categoria,v_ciudad,v_contacto,v_email,v_tel,v_direccion,v_enlace,v_beneficio,v_condiciones,v_vigencia);
  return jsonb_build_object('ok',true);
end;
$$;

create function public.pg_operaciones_registros_renta(
  p_user text,p_password text,p_condominio bigint,p_accion jsonb default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  v_id bigint;
  v_accion text := p_accion->>'tipo';
  v_valor text := p_accion->>'valor';
  v_renta echo_privado.operaciones_rentas;
begin
  if not echo_privado.operaciones_acceso(v_admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;

  if p_accion is not null then
    if coalesce(p_accion->>'id','') !~ '^[0-9]{1,15}$' then
      return jsonb_build_object('ok',false,'error','El registro no es válido.');
    end if;
    v_id:=(p_accion->>'id')::bigint;
    if v_accion='detalle' then
      select * into v_renta from echo_privado.operaciones_rentas where id=v_id and condominio_id=p_condominio;
      if not found then return jsonb_build_object('ok',false,'error','No encontramos el registro.'); end if;
      return jsonb_build_object('ok',true,'registro',to_jsonb(v_renta)-'condominio_id','fotos',coalesce((
        select jsonb_agg(replace(encode(f.datos,'base64'),chr(10),'') order by f.orden)
        from echo_privado.operaciones_rentas_fotos f where f.renta_id=v_id
      ),'[]'::jsonb));
    elsif v_accion='estado' and v_valor in ('aprobada','rechazada','archivada') then
      begin
        update echo_privado.operaciones_rentas
        set estado=v_valor,revisado_at=now(),revisado_por=v_admin.user_id
        where id=v_id and condominio_id=p_condominio and (
          (estado='pendiente' and v_valor in ('aprobada','rechazada')) or
          (estado='aprobada' and v_valor='archivada')
        );
        if not found then return jsonb_build_object('ok',false,'error','El registro cambió. Actualiza la lista.'); end if;
      exception when unique_violation then
        return jsonb_build_object('ok',false,'error','La unidad ya tiene una renta aprobada. Archiva ese registro para aprobar el nuevo.');
      end;
    elsif v_accion='situacion' and v_valor in ('disponible','rentado') then
      update echo_privado.operaciones_rentas
      set situacion=v_valor,revisado_at=now(),revisado_por=v_admin.user_id
      where id=v_id and condominio_id=p_condominio and estado='aprobada';
      if not found then return jsonb_build_object('ok',false,'error','El registro cambió. Actualiza la lista.'); end if;
    else
      return jsonb_build_object('ok',false,'error','Acción inválida.');
    end if;
    return jsonb_build_object('ok',true);
  end if;

  return jsonb_build_object('ok',true,'registros',coalesce((
    select jsonb_agg(to_jsonb(x) order by x.creado_at desc nulls last,x.edificio,x.unidad) from (
      select r.id,'registro'::text origen,r.edificio,r.unidad,r.titulo,r.plazos,r.situacion,r.estado,
        r.precio,r.periodo_precio,r.fecha_disponible,r.creado_at
      from echo_privado.operaciones_rentas r where r.condominio_id=p_condominio
      union all
      select u.id,'vacacional',u.edificio,u.numero,coalesce(v.nombre,'Programa vacacional'),array['corto'],
        null,null,v.precio,case when v.precio is not null then 'noche' end,
        null,v.creado_at
      from public.unidades u
      join lateral (
        select w.nombre,w.precio,w.creado_at from (
          select ru.nombre_publicado nombre,ru.tarifa_noche precio,ru.created_at creado_at,1 prioridad
          from public.rentas_unidades ru where ru.unidad_id=u.id and ru.condominio_id=p_condominio and ru.activa
          union all
          select null,null,ur.activada_at,2 from public.unidades_renta ur
          where ur.unidad_id=u.id and ur.condominio_id=p_condominio and ur.activa
        ) w order by w.prioridad,w.creado_at desc nulls last limit 1
      ) v on true
      where u.condominio_id=p_condominio and not exists (
        select 1 from echo_privado.operaciones_rentas r where r.condominio_id=p_condominio and r.estado='aprobada'
          and r.edificio=upper(regexp_replace(btrim(u.edificio),'[[:space:]]+',' ','g'))
          and r.unidad=upper(regexp_replace(btrim(u.numero),'[[:space:]]+',' ','g'))
      )
    ) x
  ),'[]'::jsonb));
end;
$$;

create function public.pg_operaciones_solicitudes_negocios(
  p_user text,p_password text,p_accion jsonb default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  v_id bigint;
  v_estado text := p_accion->>'estado';
begin
  if v_admin.rol is distinct from 'plataforma' then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if p_accion is not null then
    if coalesce(p_accion->>'id','') !~ '^[0-9]{1,15}$'
      or coalesce(v_estado,'') not in ('pendiente','contactado','aceptado','rechazado') then
      return jsonb_build_object('ok',false,'error','La propuesta o el estado no es válido.');
    end if;
    v_id:=(p_accion->>'id')::bigint;
    update echo_privado.operaciones_negocios
    set estado=v_estado,revisado_at=now(),revisado_por=v_admin.user_id where id=v_id;
    if not found then return jsonb_build_object('ok',false,'error','No encontramos la propuesta.'); end if;
    return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('ok',true,'negocios',coalesce((
    select jsonb_agg(to_jsonb(n) order by n.creado_at desc) from echo_privado.operaciones_negocios n
  ),'[]'::jsonb));
end;
$$;

revoke all on function echo_privado.contacto_registro_valido(text,text) from public,anon,authenticated;
revoke all on function public.echo_registrar_departamento(text,jsonb),public.echo_registrar_negocio(jsonb),
  public.pg_operaciones_registros_renta(text,text,bigint,jsonb),public.pg_operaciones_solicitudes_negocios(text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.echo_registrar_departamento(text,jsonb),public.echo_registrar_negocio(jsonb),
  public.pg_operaciones_registros_renta(text,text,bigint,jsonb),public.pg_operaciones_solicitudes_negocios(text,text,jsonb)
  to anon,authenticated;

-- Require a password on the earlier platform-only rental intake.
CREATE OR REPLACE FUNCTION public.panel_rentas(p_user text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text; v_rol text;
begin
  select password_hash, rol into v_hash, v_rol from public.admins where user_id = p_user limit 1;
  if v_hash is null or v_rol is distinct from 'plataforma' or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true,
    'solicitudes', coalesce((
      select json_agg(row_to_json(t)) from (
        select id, nombre, telefono, correo, desarrollo, direccion, habitaciones, banos,
               capacidad, se_renta, plataformas, disponibilidad, comentarios, estado, created_at
        from public.solicitudes_propietarios order by created_at desc
      ) t), '[]'::json));
end;$function$;
