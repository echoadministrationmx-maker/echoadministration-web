create table echo_privado.cuentas_inmuebles (
  id bigint generated always as identity primary key,
  usuario text not null unique,
  nombre text not null,
  clave_hash text not null,
  fallos integer not null default 0,
  ventana_fallos timestamptz not null default now(),
  creado_at timestamptz not null default now()
);
create table echo_privado.sesiones_inmuebles (
  token_hash bytea primary key,
  cuenta_id bigint not null references echo_privado.cuentas_inmuebles(id) on delete cascade,
  vence_at timestamptz not null
);
create index sesiones_inmuebles_cuenta_idx on echo_privado.sesiones_inmuebles(cuenta_id);
create table echo_privado.publicaciones_inmuebles (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references echo_privado.cuentas_inmuebles(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','publicada','cambios','rechazada','oculta')),
  version integer not null default 1,
  datos jsonb not null,
  nota text,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  publicado_at timestamptz,
  revisado_por text
);
create index publicaciones_inmuebles_cuenta_idx on echo_privado.publicaciones_inmuebles(cuenta_id,actualizado_at desc);
create index publicaciones_inmuebles_publicadas_idx on echo_privado.publicaciones_inmuebles(publicado_at desc,id desc) where estado='publicada';
create index publicaciones_inmuebles_revision_idx on echo_privado.publicaciones_inmuebles(estado,actualizado_at desc);
create table echo_privado.fotos_inmuebles (
  publicacion_id bigint references echo_privado.publicaciones_inmuebles(id) on delete cascade,
  orden smallint check (orden between 1 and 4),
  datos bytea not null check (octet_length(datos) between 4 and 160000),
  primary key(publicacion_id,orden)
);
alter table echo_privado.cuentas_inmuebles enable row level security;
alter table echo_privado.sesiones_inmuebles enable row level security;
alter table echo_privado.publicaciones_inmuebles enable row level security;
alter table echo_privado.fotos_inmuebles enable row level security;
revoke all on echo_privado.cuentas_inmuebles,echo_privado.sesiones_inmuebles,echo_privado.publicaciones_inmuebles,echo_privado.fotos_inmuebles from public,anon,authenticated;

create function public.echo_cuenta_inmuebles(p_accion text,p_usuario text,p_clave text,p_nombre text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_usuario text := lower(btrim(coalesce(p_usuario,'')));
  v_nombre text := btrim(coalesce(p_nombre,''));
  v_cuenta echo_privado.cuentas_inmuebles;
  v_token text;
  v_fallos integer;
begin
  if p_accion is null or p_accion not in ('crear','entrar') or v_usuario !~ '^[a-z0-9][a-z0-9._-]{3,39}$'
    or coalesce(octet_length(p_clave),0) not between 10 and 64 then
    return jsonb_build_object('ok',false,'error','Usa un usuario de 4 a 40 caracteres y una contraseña de al menos 10 caracteres.');
  end if;
  if p_accion='crear' then
    if char_length(v_nombre) not between 2 and 120 or char_length(p_clave)<10 then
      return jsonb_build_object('ok',false,'error','Revisa tu nombre y elige una contraseña de al menos 10 caracteres.');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('echo_cuentas_inmuebles_alta',0));
    if (select count(*) from echo_privado.cuentas_inmuebles where creado_at>now()-interval '10 minutes')>=50 then
      return jsonb_build_object('ok',false,'error','Hay varias altas en curso. Intenta más tarde.');
    end if;
    insert into echo_privado.cuentas_inmuebles(usuario,nombre,clave_hash)
    values (v_usuario,v_nombre,extensions.crypt(p_clave,extensions.gen_salt('bf',8)))
    on conflict (usuario) do nothing returning * into v_cuenta;
    if not found then return jsonb_build_object('ok',false,'error','Ese usuario ya está en uso. Elige otro o inicia sesión.'); end if;
  else
    select * into v_cuenta from echo_privado.cuentas_inmuebles where usuario=v_usuario for update;
    if not found then return jsonb_build_object('ok',false,'error','Usuario o contraseña incorrectos.'); end if;
    v_fallos:=case when v_cuenta.ventana_fallos>now()-interval '10 minutes' then v_cuenta.fallos else 0 end;
    if v_fallos>=12 then return jsonb_build_object('ok',false,'error','Se agotaron los intentos. Intenta en diez minutos.'); end if;
    if extensions.crypt(p_clave,v_cuenta.clave_hash) is distinct from v_cuenta.clave_hash then
      update echo_privado.cuentas_inmuebles set fallos=v_fallos+1,
        ventana_fallos=case when v_fallos=0 then now() else ventana_fallos end where id=v_cuenta.id;
      return jsonb_build_object('ok',false,'error','Usuario o contraseña incorrectos.');
    end if;
    update echo_privado.cuentas_inmuebles set fallos=0 where id=v_cuenta.id and fallos<>0;
  end if;

  delete from echo_privado.sesiones_inmuebles where cuenta_id=v_cuenta.id and vence_at<=now();
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into echo_privado.sesiones_inmuebles values(extensions.digest(v_token,'sha256'),v_cuenta.id,now()+interval '14 days');
  return jsonb_build_object('ok',true,'token',v_token,'nombre',v_cuenta.nombre);
end;
$$;

create function echo_privado.fotos_publicacion_inmueble(p_id bigint)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(replace(encode(f.datos,'base64'),chr(10),'') order by f.orden),'[]'::jsonb)
  from echo_privado.fotos_inmuebles f where f.publicacion_id=p_id;
$$;

create function public.echo_mis_inmuebles(p_token text,p_accion jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_cuenta echo_privado.cuentas_inmuebles;
  v_publicacion echo_privado.publicaciones_inmuebles;
  v_accion text := p_accion->>'tipo';
  v_datos jsonb := p_accion->'datos';
  v_id bigint;
  v_fotos jsonb := p_accion->'fotos';
  v_foto text;
  v_bytes bytea;
  v_precio numeric(12,2);
  v_habitaciones integer;
  v_banos numeric(3,1);
  v_limpios jsonb;
begin
  if coalesce(p_token,'') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'sesion_vencida',true,'error','Inicia sesión para continuar.'); end if;
  select c.* into v_cuenta from echo_privado.sesiones_inmuebles s join echo_privado.cuentas_inmuebles c on c.id=s.cuenta_id
  where s.token_hash=extensions.digest(p_token,'sha256') and s.vence_at>now();
  if not found then return jsonb_build_object('ok',false,'sesion_vencida',true,'error','Inicia sesión para continuar.'); end if;

  if p_accion is null then
    return jsonb_build_object('ok',true,'nombre',v_cuenta.nombre,'publicaciones',coalesce((
      select jsonb_agg(to_jsonb(p)-'cuenta_id'-'revisado_por' order by p.actualizado_at desc,p.id desc)
      from echo_privado.publicaciones_inmuebles p where p.cuenta_id=v_cuenta.id
    ),'[]'::jsonb));
  end if;
  if v_accion='salir' then
    delete from echo_privado.sesiones_inmuebles where token_hash=extensions.digest(p_token,'sha256');
    return jsonb_build_object('ok',true);
  end if;
  if p_accion ? 'id' then
    if coalesce(p_accion->>'id','') !~ '^[0-9]{1,15}$' then return jsonb_build_object('ok',false,'error','Publicación inválida.'); end if;
    v_id:=(p_accion->>'id')::bigint;
    select * into v_publicacion from echo_privado.publicaciones_inmuebles where id=v_id and cuenta_id=v_cuenta.id for update;
    if not found then return jsonb_build_object('ok',false,'error','No encontramos la publicación.'); end if;
    if v_accion='detalle' then
      return jsonb_build_object('ok',true,'registro',to_jsonb(v_publicacion)-'cuenta_id'-'revisado_por',
        'fotos',echo_privado.fotos_publicacion_inmueble(v_id));
    end if;
    if (p_accion->>'version') is distinct from v_publicacion.version::text then
      return jsonb_build_object('ok',false,'error','La publicación cambió. Vuelve a abrirla.');
    end if;
  end if;
  if v_accion='ocultar' and v_id is not null then
    update echo_privado.publicaciones_inmuebles set estado='oculta',nota=null,revisado_por=null,publicado_at=null,version=version+1,actualizado_at=now() where id=v_id;
    return jsonb_build_object('ok',true);
  end if;
  if v_accion is distinct from 'guardar' or jsonb_typeof(v_datos) is distinct from 'object' then
    return jsonb_build_object('ok',false,'error','Acción inválida.');
  end if;

  if coalesce(v_datos->>'operacion','') not in ('renta','venta')
    or char_length(btrim(coalesce(v_datos->>'titulo',''))) not between 4 and 120
    or char_length(btrim(coalesce(v_datos->>'ciudad',''))) not between 2 and 100
    or char_length(btrim(coalesce(v_datos->>'region',''))) not between 2 and 100
    or char_length(btrim(coalesce(v_datos->>'zona',''))) not between 2 and 100
    or char_length(btrim(coalesce(v_datos->>'descripcion',''))) not between 10 and 1500
    or char_length(coalesce(v_datos->>'direccion',''))>240
    or (v_datos->>'operacion'='renta' and coalesce(v_datos->>'plazo','') not in ('corto','mediano','largo'))
    or (v_datos->>'operacion'='renta' and coalesce(v_datos->>'periodo','') not in ('noche','semana','mes'))
    or not echo_privado.contacto_registro_valido(nullif(lower(btrim(v_datos->>'email')),''),nullif(btrim(v_datos->>'telefono'),'')) then
    return jsonb_build_object('ok',false,'error','Revisa la ubicación, la descripción, el plazo y tus datos de contacto.');
  end if;
  if v_fotos is not null and jsonb_typeof(v_fotos) is distinct from 'array' then
    return jsonb_build_object('ok',false,'error','Selecciona hasta cuatro fotos.');
  end if;
  if coalesce(jsonb_array_length(v_fotos),0)>4 then return jsonb_build_object('ok',false,'error','Selecciona hasta cuatro fotos.'); end if;
  begin
    v_precio:=nullif(v_datos->>'precio','')::numeric(12,2);
    v_habitaciones:=nullif(v_datos->>'habitaciones','')::integer;
    v_banos:=nullif(v_datos->>'banos','')::numeric(3,1);
    for v_foto in select jsonb_array_elements_text(v_fotos) loop
      if v_foto is null or char_length(v_foto)>213336 or v_foto !~ '^[A-Za-z0-9+/]+={0,2}$' then
        return jsonb_build_object('ok',false,'error','Una foto tiene un formato o tamaño inválido.');
      end if;
      v_bytes:=decode(v_foto,'base64');
      if octet_length(v_bytes) not between 4 and 160000 or substring(v_bytes from 1 for 3)<>decode('ffd8ff','hex')
        or substring(v_bytes from octet_length(v_bytes)-1)<>decode('ffd9','hex') then
        return jsonb_build_object('ok',false,'error','Una foto tiene un formato inválido.');
      end if;
    end loop;
  exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'error','Revisa el precio, las características y las fotos.');
  end;
  if v_precio is null or v_precio<=0 or v_precio='NaN'::numeric or v_habitaciones not between 0 and 25
    or (v_banos is not null and (v_banos not between 0 and 25 or v_banos='NaN'::numeric)) then
    return jsonb_build_object('ok',false,'error','Indica un precio válido y revisa las características.');
  end if;
  v_limpios:=jsonb_build_object('operacion',v_datos->>'operacion','titulo',btrim(v_datos->>'titulo'),
    'ciudad',btrim(v_datos->>'ciudad'),'region',btrim(v_datos->>'region'),'zona',btrim(v_datos->>'zona'),
    'direccion',nullif(btrim(v_datos->>'direccion'),''),
    'descripcion',btrim(v_datos->>'descripcion'),'precio',v_precio,'habitaciones',v_habitaciones,'banos',v_banos,
    'plazo',case when v_datos->>'operacion'='renta' then v_datos->>'plazo' end,
    'periodo',case when v_datos->>'operacion'='renta' then v_datos->>'periodo' end,
    'email',nullif(lower(btrim(v_datos->>'email')),''),'telefono',nullif(btrim(v_datos->>'telefono'),''));

  if v_id is null then
    perform pg_advisory_xact_lock(hashtextextended('echo_publicacion_inmueble:'||v_cuenta.id,0));
    if (select count(*) from echo_privado.publicaciones_inmuebles where cuenta_id=v_cuenta.id)>=50 then
      return jsonb_build_object('ok',false,'error','Alcanzaste el límite de publicaciones. Contacta a Echo.');
    end if;
    insert into echo_privado.publicaciones_inmuebles(cuenta_id,datos) values(v_cuenta.id,v_limpios) returning id into v_id;
  else
    update echo_privado.publicaciones_inmuebles set datos=v_limpios,estado='pendiente',version=version+1,
      nota=null,revisado_por=null,publicado_at=null,actualizado_at=now() where id=v_id;
  end if;
  if v_fotos is not null then
    delete from echo_privado.fotos_inmuebles where publicacion_id=v_id;
    insert into echo_privado.fotos_inmuebles(publicacion_id,orden,datos)
    select v_id,n,decode(x,'base64') from jsonb_array_elements_text(v_fotos) with ordinality f(x,n);
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;

create function public.pg_operaciones_publicaciones_inmuebles(p_user text,p_password text,p_accion jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  v_accion text := p_accion->>'tipo';
  v_estado text := p_accion->>'estado';
  v_nota text := nullif(btrim(p_accion->>'nota'),'');
  v_id bigint;
  v_version integer;
  v_publicacion echo_privado.publicaciones_inmuebles;
begin
  if v_admin.rol is distinct from 'plataforma' then return jsonb_build_object('ok',false,'error','Acceso no autorizado.'); end if;
  if p_accion is null then
    return jsonb_build_object('ok',true,'publicaciones',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'estado',p.estado,'datos',p.datos,
        'nota',p.nota,'actualizado_at',p.actualizado_at,'propietario',c.nombre,'usuario',c.usuario)
        order by p.actualizado_at desc,p.id desc)
      from echo_privado.publicaciones_inmuebles p join echo_privado.cuentas_inmuebles c on c.id=p.cuenta_id
    ),'[]'::jsonb));
  end if;
  if coalesce(p_accion->>'id','') !~ '^[0-9]{1,15}$' then return jsonb_build_object('ok',false,'error','Publicación inválida.'); end if;
  v_id:=(p_accion->>'id')::bigint;
  if v_accion='detalle' then
    select * into v_publicacion from echo_privado.publicaciones_inmuebles where id=v_id;
    if not found then return jsonb_build_object('ok',false,'error','No encontramos la publicación.'); end if;
    return jsonb_build_object('ok',true,'registro',to_jsonb(v_publicacion)-'cuenta_id',
      'fotos',echo_privado.fotos_publicacion_inmueble(v_id));
  end if;
  if v_accion is distinct from 'revisar' or coalesce(v_estado,'') not in ('publicada','cambios','rechazada','oculta')
    or coalesce(p_accion->>'version','') !~ '^[0-9]{1,9}$' or char_length(v_nota)>1000
    or (v_estado in ('cambios','rechazada') and v_nota is null) then
    return jsonb_build_object('ok',false,'error','Revisa el estado y agrega una nota al pedir cambios o rechazar.');
  end if;
  v_version:=(p_accion->>'version')::int;
  update echo_privado.publicaciones_inmuebles
  set estado=v_estado,nota=v_nota,revisado_por=v_admin.user_id,actualizado_at=now(),version=version+1,
    publicado_at=case when v_estado='publicada' then now() end
  where id=v_id and version=v_version and (
    (estado='pendiente' and v_estado in ('publicada','cambios','rechazada')) or
    (estado='publicada' and v_estado in ('oculta','cambios')) or
    (estado='oculta' and revisado_por is not null and v_estado='publicada')
  );
  if not found then return jsonb_build_object('ok',false,'error','La publicación cambió. Actualiza la bandeja antes de revisarla.'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

create function echo_privado.campos_publicos_inmueble(p_datos jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_object_agg(key,value) from jsonb_each(p_datos)
  where key in ('operacion','titulo','ciudad','region','zona','descripcion','precio','habitaciones','banos','plazo','periodo');
$$;

create function public.echo_catalogo_inmuebles(p_operacion text default null,p_busqueda text default null,
  p_pagina integer default 0,p_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  v_busqueda text := lower(left(btrim(coalesce(p_busqueda,'')),100));
  v_inicio integer := greatest(0,least(coalesce(p_pagina,0),10000))*8;
  v_datos jsonb;
begin
  if p_id is not null then
    select echo_privado.campos_publicos_inmueble(p.datos) into v_datos
    from echo_privado.publicaciones_inmuebles p where p.id=p_id and p.estado='publicada';
    if not found then return jsonb_build_object('ok',false,'error','Esta publicación ya no está disponible.'); end if;
    return jsonb_build_object('ok',true,'id',p_id,'datos',v_datos,'fotos',echo_privado.fotos_publicacion_inmueble(p_id));
  end if;
  return (
    with pagina as (
      select p.id,p.datos,p.publicado_at,row_number() over(order by p.publicado_at desc,p.id desc) as posicion
      from echo_privado.publicaciones_inmuebles p
      where p.estado='publicada' and (p_operacion is null or p.datos->>'operacion'=p_operacion)
        and (v_busqueda='' or strpos(lower(concat_ws(' ',p.datos->>'ciudad',p.datos->>'region',p.datos->>'zona',p.datos->>'titulo')),v_busqueda)>0)
      order by p.publicado_at desc,p.id desc offset v_inicio limit 9
    )
    select jsonb_build_object('ok',true,'hay_mas',count(*)>8,'publicaciones',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'datos',echo_privado.campos_publicos_inmueble(p.datos),'foto',(
        select replace(encode(f.datos,'base64'),chr(10),'') from echo_privado.fotos_inmuebles f
        where f.publicacion_id=p.id order by f.orden limit 1
      )) order by p.posicion)
      from pagina p where p.posicion<=v_inicio+8
    ),'[]'::jsonb)) from pagina
  );
end;
$$;

revoke all on function echo_privado.fotos_publicacion_inmueble(bigint),echo_privado.campos_publicos_inmueble(jsonb)
  from public,anon,authenticated;
revoke all on function public.echo_cuenta_inmuebles(text,text,text,text),public.echo_mis_inmuebles(text,jsonb),
  public.pg_operaciones_publicaciones_inmuebles(text,text,jsonb),public.echo_catalogo_inmuebles(text,text,integer,bigint)
  from public,anon,authenticated;
grant execute on function public.echo_cuenta_inmuebles(text,text,text,text),public.echo_mis_inmuebles(text,jsonb),
  public.pg_operaciones_publicaciones_inmuebles(text,text,jsonb),public.echo_catalogo_inmuebles(text,text,integer,bigint)
  to anon,authenticated;
