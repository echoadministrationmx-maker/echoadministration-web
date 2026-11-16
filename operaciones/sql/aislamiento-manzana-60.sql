create or replace function echo_privado.operaciones_acceso(a public.admins,p_condominio bigint)
returns boolean language sql stable set search_path = pg_catalog as $$
  select a.id is not null and exists (
    select 1 from public.condominios c
    where c.id=p_condominio and c.activo and c.codigo is distinct from 'APP-REVIEW'
      and case
        when a.rol='plataforma' then true
        when a.rol='operaciones_local' then c.codigo='M60' and c.id=a.condominio_id
        when c.codigo='M60' then false
        else c.id=a.condominio_id or c.id=any(a.condominios_permitidos)
          or exists (select 1 from public.admin_condominios ac where ac.admin_user=a.user_id and ac.condominio_id=c.id)
      end
  );
$$;

create or replace function public.pg_condominios(p_user text,p_password text)
returns json language plpgsql security definer set search_path = pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
begin
  if admin.id is null or admin.rol='operaciones_local' then return json_build_object('ok',false); end if;
  return json_build_object('ok',true,'condominios',coalesce((
    select json_agg(row_to_json(t)) from (
      select c.id,c.codigo,c.nombre,c.ciudad,c.cuota_ordinaria,
        (select count(*) from public.unidades u where u.condominio_id=c.id) as unidades
      from public.condominios c where echo_privado.operaciones_acceso(admin,c.id)
      order by c.id
    ) t
  ),'[]'::json));
end;
$$;

create or replace function public.pg_mis_condominios(p_user text,p_password text)
returns json language plpgsql security definer set search_path = pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
begin
  if admin.id is null or admin.rol='operaciones_local' then return json_build_object('ok',false); end if;
  return json_build_object('ok',true,'condominios',coalesce((
    select json_agg(row_to_json(t)) from (
      select c.id,c.codigo,c.nombre,c.ciudad,c.cuota_ordinaria,
        (select count(*) from public.unidades u where u.condominio_id=c.id) as unidades,
        coalesce((select sum(p.monto) from public.pagos p where p.condominio_id=c.id and p.estado='pendiente'),0) as adeudo
      from public.condominios c where echo_privado.operaciones_acceso(admin,c.id)
      order by c.nombre,c.id
    ) t
  ),'[]'::json));
end;
$$;

-- Older Operations endpoints still accept a property or unit ID directly.
CREATE OR REPLACE FUNCTION public.pg_activar_renta(p_user text, p_password text, p_unidad bigint, p_activa boolean, p_ical_airbnb text DEFAULT NULL::text, p_ical_booking text DEFAULT NULL::text, p_comision numeric DEFAULT NULL::numeric, p_limpieza numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text; v_res int; v_cond int;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  select u.condominio_id into v_cond from public.unidades u where u.id=p_unidad;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),v_cond) then
    return json_build_object('ok',false);
  end if;
  select r.id_residente into v_res from public.residentes r join public.unidades u on upper(u.identificador)=upper(regexp_replace(coalesce(r.num,''),'\s+','','g'))||'-'||regexp_replace(r.departamento,'\s+','','g') where u.id=p_unidad and r.condominio_id=v_cond limit 1;
  insert into public.unidades_renta(unidad_id, id_residente, condominio_id, activa, ical_airbnb, ical_booking, comision_pct, tarifa_limpieza, activada_por, activada_at)
  values (p_unidad, v_res, coalesce(v_cond,1), coalesce(p_activa,false), nullif(trim(p_ical_airbnb),''), nullif(trim(p_ical_booking),''), coalesce(p_comision,20), coalesce(p_limpieza,0), p_user, now())
  on conflict (unidad_id) do update set
    activa=coalesce(p_activa, public.unidades_renta.activa),
    ical_airbnb=coalesce(nullif(trim(p_ical_airbnb),''), public.unidades_renta.ical_airbnb),
    ical_booking=coalesce(nullif(trim(p_ical_booking),''), public.unidades_renta.ical_booking),
    comision_pct=coalesce(p_comision, public.unidades_renta.comision_pct),
    tarifa_limpieza=coalesce(p_limpieza, public.unidades_renta.tarifa_limpieza),
    activada_por=p_user, updated_at=now();
  return json_build_object('ok',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_cargar_recibo_servicio(p_user text, p_password text, p_ident text, p_tipo text, p_periodo text, p_consumo text, p_monto numeric, p_venc date, p_url text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text; v_u bigint; v_res int;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),1) then
    return json_build_object('ok',false);
  end if;
  if coalesce(trim(p_ident),'')<>'' then
    select id into v_u from public.unidades where condominio_id=1 and upper(identificador)=upper(trim(p_ident)) limit 1;
    select id_residente into v_res from public.residentes
      where condominio_id=1 and upper(regexp_replace(coalesce(num,''),'\s+','','g'))||'-'||regexp_replace(departamento,'\s+','','g')=upper(trim(p_ident)) limit 1;
  end if;
  insert into public.recibos_servicios(unidad_id, id_residente, tipo, periodo, consumo, monto, fecha_vencimiento, archivo_url, creado_por)
  values (v_u, v_res, lower(trim(p_tipo)), trim(p_periodo), nullif(trim(p_consumo),''), coalesce(p_monto,0), p_venc, nullif(trim(p_url),''), p_user);
  return json_build_object('ok',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_crear_gasto(p_user text, p_password text, p_condominio integer, p_fecha date, p_proveedor text, p_concepto text, p_categoria text, p_subtotal numeric, p_iva numeric, p_facturado boolean, p_uuid text, p_forma text, p_notas text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),coalesce(p_condominio,1)) then
    return json_build_object('ok',false);
  end if;
  if coalesce(trim(p_concepto),'')='' or coalesce(p_subtotal,0)<=0 then return json_build_object('ok',false,'error','datos incompletos'); end if;
  insert into public.gastos_operacion(condominio_id, fecha, proveedor, concepto, categoria, subtotal, iva, total,
      facturado, uuid_cfdi, forma_pago, notas, creado_por)
  values (coalesce(p_condominio,1), coalesce(p_fecha,current_date), nullif(trim(p_proveedor),''), trim(p_concepto),
      coalesce(nullif(trim(p_categoria),''),'operativo'), p_subtotal, coalesce(p_iva,0),
      p_subtotal + coalesce(p_iva,0), coalesce(p_facturado,false), nullif(trim(p_uuid),''),
      coalesce(nullif(trim(p_forma),''),'Transferencia'), nullif(trim(p_notas),''), p_user);
  return json_build_object('ok',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_gastos(p_user text, p_password text, p_condominio integer DEFAULT 1, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text; v_y int; v_m int;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),coalesce(p_condominio,1)) then
    return json_build_object('ok',false);
  end if;
  v_y := coalesce(p_anio, extract(year from current_date)::int);
  v_m := coalesce(p_mes, extract(month from current_date)::int);
  return json_build_object('ok',true,'anio',v_y,'mes',v_m,
    'gastos', coalesce((select json_agg(row_to_json(t)) from (
      select id, fecha, proveedor, concepto, categoria, subtotal, iva, total, facturado, uuid_cfdi, forma_pago, creado_por
      from public.gastos_operacion
      where condominio_id=p_condominio and extract(year from fecha)=v_y and extract(month from fecha)=v_m
      order by fecha desc, id desc) t),'[]'::json),
    'resumen', (select json_build_object(
        'total_gastos', coalesce(sum(total),0),
        'subtotal', coalesce(sum(subtotal),0),
        'iva_acreditable', coalesce(sum(iva) filter (where facturado),0),
        'sin_factura', coalesce(sum(total) filter (where not facturado),0),
        'cuenta_facturados', count(*) filter (where facturado),
        'cuenta_pendientes', count(*) filter (where not facturado)
      ) from public.gastos_operacion
      where condominio_id=p_condominio and extract(year from fecha)=v_y and extract(month from fecha)=v_m),
    'por_categoria', coalesce((select json_agg(row_to_json(c)) from (
      select categoria, sum(total) as total, count(*) as num
      from public.gastos_operacion
      where condominio_id=p_condominio and extract(year from fecha)=v_y and extract(month from fecha)=v_m
      group by categoria order by sum(total) desc) c),'[]'::json),
    'ingresos_mes', (select coalesce(sum(monto),0) from public.pagos
      where condominio_id=p_condominio and estado='pagado' and extract(year from fecha_pago)=v_y and extract(month from fecha_pago)=v_m));
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_guardar_renta(p_user text, p_password text, p_unidad_id bigint, p_activa boolean, p_nombre text, p_recamaras integer, p_capacidad integer, p_tarifa numeric, p_comision numeric, p_ical_airbnb text, p_ical_booking text, p_notas text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text; v_res int; v_cond int; v_ident text;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  select u.condominio_id, upper(u.identificador) into v_cond, v_ident from public.unidades u where u.id=p_unidad_id;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),v_cond) then
    return json_build_object('ok',false);
  end if;
  select r.id_residente into v_res from public.residentes r
    where upper(regexp_replace(coalesce(r.num,''),'\s+','','g'))||'-'||regexp_replace(r.departamento,'\s+','','g') = v_ident and r.condominio_id=v_cond limit 1;
  insert into public.rentas_unidades(unidad_id, condominio_id, id_residente, activa, nombre_publicado,
      recamaras, capacidad, tarifa_noche, comision_echo, ical_airbnb, ical_booking, notas, aprobado_at, aprobado_por)
  values (p_unidad_id, coalesce(v_cond,1), v_res, coalesce(p_activa,false), nullif(trim(p_nombre),''),
      p_recamaras, p_capacidad, p_tarifa, coalesce(p_comision,20), nullif(trim(p_ical_airbnb),''),
      nullif(trim(p_ical_booking),''), nullif(trim(p_notas),''),
      case when p_activa then now() end, case when p_activa then p_user end)
  on conflict (unidad_id) do update set
    activa=coalesce(excluded.activa, rentas_unidades.activa),
    id_residente=coalesce(excluded.id_residente, rentas_unidades.id_residente),
    nombre_publicado=coalesce(excluded.nombre_publicado, rentas_unidades.nombre_publicado),
    recamaras=coalesce(excluded.recamaras, rentas_unidades.recamaras),
    capacidad=coalesce(excluded.capacidad, rentas_unidades.capacidad),
    tarifa_noche=coalesce(excluded.tarifa_noche, rentas_unidades.tarifa_noche),
    comision_echo=coalesce(excluded.comision_echo, rentas_unidades.comision_echo),
    ical_airbnb=excluded.ical_airbnb, ical_booking=excluded.ical_booking,
    notas=coalesce(excluded.notas, rentas_unidades.notas),
    aprobado_at=case when excluded.activa and rentas_unidades.aprobado_at is null then now() else rentas_unidades.aprobado_at end,
    aprobado_por=case when excluded.activa and rentas_unidades.aprobado_por is null then p_user else rentas_unidades.aprobado_por end,
    updated_at=now();
  return json_build_object('ok',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_recibos_servicios(p_user text, p_password text, p_condominio integer DEFAULT 1, p_periodo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),coalesce(p_condominio,1)) then
    return json_build_object('ok',false);
  end if;
  return json_build_object('ok',true,
    'recibos', coalesce((select json_agg(row_to_json(t)) from (
      select rs.id, rs.tipo, rs.periodo, rs.consumo, rs.monto, rs.fecha_vencimiento, rs.pagado, rs.archivo_url,
             coalesce(u.identificador,'Áreas comunes') as ident, r.nombre_completo as propietario, rs.creado_por
      from public.recibos_servicios rs
      left join public.unidades u on u.id=rs.unidad_id
      left join public.residentes r on r.id_residente=rs.id_residente
      where rs.condominio_id=p_condominio and (p_periodo is null or rs.periodo=p_periodo)
      order by rs.periodo desc, rs.id desc limit 300) t),'[]'::json),
    'resumen', (select json_build_object(
      'total', coalesce(sum(monto),0),
      'luz', coalesce(sum(monto) filter (where tipo='luz'),0),
      'agua', coalesce(sum(monto) filter (where tipo='agua'),0),
      'pendiente', coalesce(sum(monto) filter (where not pagado),0),
      'num', count(*))
      from public.recibos_servicios where condominio_id=p_condominio and (p_periodo is null or periodo=p_periodo)),
    'periodos', coalesce((select json_agg(distinct periodo order by periodo desc) from public.recibos_servicios where condominio_id=p_condominio),'[]'::json));
end;$function$;

CREATE OR REPLACE FUNCTION public.pg_rentas(p_user text, p_password text, p_condominio integer DEFAULT 1)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_hash text;
begin
  select password_hash into v_hash from public.admins where user_id=p_user limit 1;
  if v_hash is null or p_password is null or v_hash <> extensions.crypt(p_password, v_hash) then return json_build_object('ok',false); end if;
  if not echo_privado.operaciones_acceso((select a from public.admins a where a.user_id=p_user),coalesce(p_condominio,1)) then
    return json_build_object('ok',false);
  end if;
  return json_build_object('ok',true,'rentas', coalesce((
    select json_agg(row_to_json(t)) from (
      select ru.id, ru.unidad_id, u.identificador as ident, ru.id_residente,
        coalesce(r.nombre_completo,'—') as propietario, r.telefono, r.email,
        ru.activa, ru.nombre_publicado, ru.recamaras, ru.capacidad, ru.tarifa_noche, ru.comision_echo,
        ru.ical_airbnb, ru.ical_booking, ru.solicitado_at, ru.aprobado_at, ru.notas,
        (select count(*) from public.reservas rv where rv.unidad_id=ru.unidad_id and rv.estado<>'cancelada' and rv.checkout >= current_date) as reservas_proximas,
        (select coalesce(sum(rv.monto_total),0) from public.reservas rv where rv.unidad_id=ru.unidad_id and rv.estado<>'cancelada' and date_trunc('month',rv.checkin)=date_trunc('month',current_date)) as ingreso_mes,
        (select coalesce(sum(g.monto),0) from public.rentas_gastos g where g.unidad_id=ru.unidad_id and date_trunc('month',g.fecha)=date_trunc('month',current_date)) as gastos_mes
      from public.rentas_unidades ru
      join public.unidades u on u.id=ru.unidad_id
      left join public.residentes r on r.id_residente=ru.id_residente
      where ru.condominio_id=p_condominio
      order by ru.activa desc, u.identificador) t),'[]'::json));
end;$function$;
