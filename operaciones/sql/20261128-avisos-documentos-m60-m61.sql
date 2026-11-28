-- Avisos públicos y documentos de operaciones, aislados de Manzana 80.
create table if not exists echo_privado.operaciones_avisos_m60 (
 id bigint generated always as identity primary key,
 condominio_id bigint not null references public.condominios(id),
 titulo text not null,
 mensaje text not null,
 tipo text not null default 'info' check (tipo in ('info','alerta','urgente')),
 activo boolean not null default true,
 creado_por text not null,
 creado_at timestamptz not null default now()
);
create index if not exists operaciones_avisos_m60_publico on echo_privado.operaciones_avisos_m60(condominio_id,activo,creado_at desc);
alter table echo_privado.operaciones_avisos_m60 enable row level security;
revoke all on echo_privado.operaciones_avisos_m60 from public,anon,authenticated;

create or replace function public.pg_avisos_comunidad_m60()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((select jsonb_agg(jsonb_build_object('titulo',a.titulo,'mensaje',a.mensaje,'tipo',a.tipo,'fecha',a.creado_at) order by a.creado_at desc)
 from (select titulo,mensaje,tipo,creado_at from echo_privado.operaciones_avisos_m60
   where condominio_id=3 and activo order by creado_at desc limit 20) a),'[]'::jsonb);
$$;
revoke all on function public.pg_avisos_comunidad_m60() from public;
grant execute on function public.pg_avisos_comunidad_m60() to anon,authenticated;

create or replace function public.pg_operaciones_avisos_m60(
 p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
 accion text := p_cambio->>'accion';
begin
 if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
  return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
 end if;
 if p_cambio is not null then
  if accion='crear' then
   if char_length(btrim(coalesce(p_cambio->>'titulo',''))) not between 3 and 120
     or char_length(btrim(coalesce(p_cambio->>'mensaje',''))) not between 10 and 3000
     or coalesce(p_cambio->>'tipo','') not in ('info','alerta','urgente') then
    return jsonb_build_object('ok',false,'error','Revisa título, mensaje y tono.');
   end if;
   insert into echo_privado.operaciones_avisos_m60(condominio_id,titulo,mensaje,tipo,creado_por)
   values(3,btrim(p_cambio->>'titulo'),btrim(p_cambio->>'mensaje'),p_cambio->>'tipo',admin.user_id);
  elsif accion='estado' then
   if coalesce(p_cambio->>'id','') !~ '^[0-9]{1,16}$' or jsonb_typeof(p_cambio->'activo')<>'boolean' then
    return jsonb_build_object('ok',false,'error','Aviso inválido.');
   end if;
   update echo_privado.operaciones_avisos_m60 set activo=(p_cambio->>'activo')::boolean
   where id=(p_cambio->>'id')::bigint and condominio_id=3;
   if not found then return jsonb_build_object('ok',false,'error','Aviso no encontrado.'); end if;
  else return jsonb_build_object('ok',false,'error','Acción inválida.'); end if;
 end if;
 return jsonb_build_object('ok',true,'avisos',coalesce((select jsonb_agg(to_jsonb(a)-'condominio_id' order by a.creado_at desc,a.id desc)
 from echo_privado.operaciones_avisos_m60 a where a.condominio_id=3),'[]'::jsonb));
end;
$$;
revoke all on function public.pg_operaciones_avisos_m60(text,text,bigint,jsonb) from public;
grant execute on function public.pg_operaciones_avisos_m60(text,text,bigint,jsonb) to anon,authenticated;

create table if not exists echo_privado.operaciones_recibos_m60 (
 id bigint generated always as identity primary key,
 condominio_id bigint not null references public.condominios(id),
 historial_id bigint not null unique references echo_privado.operaciones_historial_m60(id),
 emitido_por text not null,
 emitido_at timestamptz not null default now(),
 estado text not null default 'activo' check (estado in ('activo','cancelado')),
 cancelado_por text,
 cancelado_at timestamptz,
 motivo_cancelacion text
);
create table if not exists echo_privado.operaciones_constancias_m60 (
 id bigint generated always as identity primary key,
 condominio_id bigint not null references public.condominios(id),
 unidad_id bigint not null references public.unidades(id),
 periodo_hasta date not null,
 motivo text,
 emitido_por text not null,
 emitido_at timestamptz not null default now(),
 vigente_hasta date not null,
 estado text not null default 'vigente' check (estado in ('vigente','cancelada')),
 cancelado_por text,
 cancelado_at timestamptz,
 motivo_cancelacion text
);
create index if not exists operaciones_recibos_m60_condominio on echo_privado.operaciones_recibos_m60(condominio_id,emitido_at desc);
create index if not exists operaciones_constancias_m60_condominio on echo_privado.operaciones_constancias_m60(condominio_id,emitido_at desc);
alter table echo_privado.operaciones_recibos_m60 enable row level security;
alter table echo_privado.operaciones_constancias_m60 enable row level security;
revoke all on echo_privado.operaciones_recibos_m60,echo_privado.operaciones_constancias_m60 from public,anon,authenticated;

create or replace function public.pg_operaciones_documentos_m60(
 p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
 accion text := p_cambio->>'accion'; v_unidad bigint; v_periodo date;
 hoy date := (now() at time zone 'America/Mexico_City')::date; v_id bigint;
begin
 if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
  return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
 end if;
 if p_cambio is not null then
  if accion='constancia' then
   if coalesce(p_cambio->>'unidad','') !~ '^[0-9]{1,16}$'
     or coalesce(p_cambio->>'periodo','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
     or char_length(coalesce(p_cambio->>'motivo',''))>300 then
    return jsonb_build_object('ok',false,'error','Revisa la unidad, periodo y motivo.'); end if;
   v_unidad:=(p_cambio->>'unidad')::bigint;
   v_periodo:=to_date(p_cambio->>'periodo'||'-01','YYYY-MM-DD');
   if not exists(select 1 from public.unidades u where u.id=v_unidad and u.condominio_id=3 and u.activa)
     or v_periodo<date '2026-10-01' or v_periodo>date_trunc('month',hoy)::date
     or exists(select 1 from generate_series(date '2026-10-01',v_periodo,interval '1 month') m
       where not exists(select 1 from echo_privado.operaciones_historial_m60 h
         where h.unidad_id=v_unidad and h.tipo='mensualidad' and h.periodo=m::date and h.destino='Nueva administración' and h.monto=500))
     or exists(select 1 from echo_privado.operaciones_convenios_m60 c where c.unidad_id=v_unidad and c.estado='activo' and c.saldo_confirmado>0) then
    return jsonb_build_object('ok',false,'error','No se puede emitir: verifica los pagos desde octubre de 2026 y los convenios activos.'); end if;
   insert into echo_privado.operaciones_constancias_m60(condominio_id,unidad_id,periodo_hasta,motivo,emitido_por,vigente_hasta)
   values(3,v_unidad,v_periodo,nullif(btrim(p_cambio->>'motivo'),''),admin.user_id,hoy+30) returning id into v_id;
  elsif accion='cancelar_constancia' then
   if coalesce(p_cambio->>'id','') !~ '^[0-9]{1,16}$' or char_length(btrim(coalesce(p_cambio->>'motivo',''))) not between 5 and 300 then
    return jsonb_build_object('ok',false,'error','Indica el motivo de cancelación.'); end if;
   update echo_privado.operaciones_constancias_m60 set estado='cancelada',cancelado_por=admin.user_id,cancelado_at=now(),motivo_cancelacion=btrim(p_cambio->>'motivo')
     where id=(p_cambio->>'id')::bigint and condominio_id=3 and estado='vigente';
   if not found then return jsonb_build_object('ok',false,'error','Estado no encontrado o ya cancelado.'); end if;
  elsif accion='cancelar_recibo' then
   if coalesce(p_cambio->>'id','') !~ '^[0-9]{1,16}$' or char_length(btrim(coalesce(p_cambio->>'motivo',''))) not between 5 and 300 then
    return jsonb_build_object('ok',false,'error','Indica el motivo de cancelación.'); end if;
   update echo_privado.operaciones_recibos_m60 set estado='cancelado',cancelado_por=admin.user_id,cancelado_at=now(),motivo_cancelacion=btrim(p_cambio->>'motivo')
     where id=(p_cambio->>'id')::bigint and condominio_id=3 and estado='activo';
   if not found then return jsonb_build_object('ok',false,'error','Comprobante no encontrado o ya cancelado.'); end if;
  else return jsonb_build_object('ok',false,'error','Acción inválida.'); end if;
 end if;
 return jsonb_build_object('ok',true,
  'folio_nuevo',v_id,
  'recibos',coalesce((select jsonb_agg(to_jsonb(x) order by x.emitido_at desc,x.id desc) from (
    select r.id,r.emitido_at,r.emitido_por,r.estado,r.cancelado_at,r.motivo_cancelacion,
      h.periodo,h.monto,h.destino,h.fecha_pago,h.forma_pago,h.referencia,u.id as unidad_id,u.edificio,u.numero,p.nombre,p.email
    from echo_privado.operaciones_recibos_m60 r
    join echo_privado.operaciones_historial_m60 h on h.id=r.historial_id
    join public.unidades u on u.id=h.unidad_id
    left join lateral (select pr.nombre,pr.email from echo_privado.operaciones_titularidades t
      join echo_privado.operaciones_propietarios pr on pr.id=t.propietario_id where t.unidad_id=u.id and pr.condominio_id=3 order by pr.id limit 1) p on true
    where r.condominio_id=3
  ) x),'[]'::jsonb),
  'constancias',coalesce((select jsonb_agg(to_jsonb(x) order by x.emitido_at desc,x.id desc) from (
    select c.id,c.emitido_at,c.vigente_hasta,c.estado,c.periodo_hasta,c.motivo,c.emitido_por,c.cancelado_at,c.motivo_cancelacion,
      u.edificio,u.numero,u.id as unidad_id,p.nombre
    from echo_privado.operaciones_constancias_m60 c join public.unidades u on u.id=c.unidad_id
    left join lateral (select pr.nombre from echo_privado.operaciones_titularidades t
      join echo_privado.operaciones_propietarios pr on pr.id=t.propietario_id where t.unidad_id=u.id and pr.condominio_id=3 order by pr.id limit 1) p on true
    where c.condominio_id=3
  ) x),'[]'::jsonb));
end;
$$;
revoke all on function public.pg_operaciones_documentos_m60(text,text,bigint,jsonb) from public;
grant execute on function public.pg_operaciones_documentos_m60(text,text,bigint,jsonb) to anon,authenticated;

-- Cada nuevo pago web confirmado emite un comprobante con fecha real y folio.
create or replace function public.pg_operaciones_registrar_pago_m60(
 p_user text,p_password text,p_condominio bigint,p_unidad bigint,p_periodo date,
 p_fecha_pago date,p_destino text,p_forma text,p_referencia text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
 nuevo_id bigint; nuevo_folio bigint;
 hoy date := (now() at time zone 'America/Mexico_City')::date;
begin
 if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio)
  or not exists(select 1 from public.unidades u where u.id=p_unidad and u.condominio_id=p_condominio and u.activa)
  or p_periodo is null or p_periodo<>date_trunc('month',p_periodo)::date
  or p_periodo<date '2026-10-01' or p_periodo>(date_trunc('month',hoy)+interval '12 months')::date
  or p_fecha_pago is null or p_fecha_pago<date '2026-10-01' or p_fecha_pago>hoy
  or coalesce(char_length(btrim(p_destino)),0) not between 2 and 80
  or coalesce(p_forma,'') not in ('Transferencia','Depósito','Efectivo','Tarjeta','Otro')
  or char_length(coalesce(p_referencia,''))>120 then
  return jsonb_build_object('ok',false,'error','Revisa la unidad, el mes, la fecha y los datos del pago.'); end if;
 insert into echo_privado.operaciones_historial_m60
  (unidad_id,tipo,periodo,monto,destino,fuente,fecha_pago,forma_pago,referencia,registrado_por,registrado_at)
 values(p_unidad,'mensualidad',p_periodo,500,btrim(p_destino),'Registro web',p_fecha_pago,p_forma,nullif(btrim(p_referencia),''),admin.user_id,now())
 on conflict (unidad_id,tipo,periodo) do nothing returning id into nuevo_id;
 if nuevo_id is null then
  return jsonb_build_object('ok',false,'error','Esta mensualidad ya está marcada como pagada. Revisa su registro antes de volver a capturarla.'); end if;
 if btrim(p_destino)='Nueva administración' then
  insert into echo_privado.operaciones_recibos_m60(condominio_id,historial_id,emitido_por)
  values(3,nuevo_id,admin.user_id) returning id into nuevo_folio;
 end if;
 return jsonb_build_object('ok',true,'id',nuevo_id,'folio',nuevo_folio);
end;
$$;
revoke all on function public.pg_operaciones_registrar_pago_m60(text,text,bigint,bigint,date,date,text,text,text) from public;
grant execute on function public.pg_operaciones_registrar_pago_m60(text,text,bigint,bigint,date,date,text,text,text) to anon,authenticated;
