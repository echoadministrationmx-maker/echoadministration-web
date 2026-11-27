-- El historial importado conserva fecha_pago nula; las nuevas capturas registran la fecha real.
alter table echo_privado.operaciones_historial_m60
  add column if not exists fecha_pago date,
  add column if not exists forma_pago text,
  add column if not exists referencia text,
  add column if not exists registrado_por text,
  add column if not exists registrado_at timestamptz;

create or replace function public.pg_operaciones_registrar_pago_m60(
  p_user text,p_password text,p_condominio bigint,p_unidad bigint,p_periodo date,
  p_fecha_pago date,p_destino text,p_forma text,p_referencia text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  nuevo_id bigint;
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
    return jsonb_build_object('ok',false,'error','Revisa la unidad, el mes, la fecha y los datos del pago.');
  end if;
  insert into echo_privado.operaciones_historial_m60
    (unidad_id,tipo,periodo,monto,destino,fuente,fecha_pago,forma_pago,referencia,registrado_por,registrado_at)
  values(p_unidad,'mensualidad',p_periodo,500,btrim(p_destino),'Registro web',
    p_fecha_pago,p_forma,nullif(btrim(p_referencia),''),admin.user_id,now())
  on conflict (unidad_id,tipo,periodo) do nothing returning id into nuevo_id;
  if nuevo_id is null then
    return jsonb_build_object('ok',false,'error','Esta mensualidad ya está marcada como pagada. Revisa su registro antes de volver a capturarla.');
  end if;
  return jsonb_build_object('ok',true,'id',nuevo_id);
end;
$$;
revoke all on function public.pg_operaciones_registrar_pago_m60(text,text,bigint,bigint,date,date,text,text,text) from public;
grant execute on function public.pg_operaciones_registrar_pago_m60(text,text,bigint,bigint,date,date,text,text,text) to anon,authenticated;

-- Mantener el historial legible desde el mismo filtro y mostrar únicamente fechas reales.
create or replace function public.pg_operaciones_historial_m60(
  p_user text,p_password text,p_condominio bigint,p_anio integer default 2026,
  p_edificio text default null,p_busqueda text default null,p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio)
    or p_anio not between 0 and 2100 or p_offset not between 0 and 100000
    or char_length(coalesce(p_busqueda,''))>80 then
    return jsonb_build_object('ok',false,'error','Acceso o filtros inválidos.');
  end if;
  return jsonb_build_object('ok',true,
    'edificios',coalesce((select jsonb_agg(e.edificio order by e.edificio) from
      (select distinct edificio from public.unidades where condominio_id=3) e),'[]'::jsonb),
    'total', (select count(*) from echo_privado.operaciones_historial_m60 h
      join public.unidades u on u.id=h.unidad_id
      left join echo_privado.operaciones_propietarios p on p.condominio_id=3
        and p.clave='M'||u.edificio||'-'||u.numero
      where u.condominio_id=3 and ((p_anio=0 and h.tipo='fondo_cadu') or
        (h.tipo='mensualidad' and h.periodo>=make_date(greatest(p_anio,1),1,1) and h.periodo<make_date(greatest(p_anio,1)+1,1,1)))
        and (coalesce(p_edificio,'')='' or u.edificio=p_edificio)
        and (coalesce(p_busqueda,'')='' or u.identificador ilike '%'||p_busqueda||'%'
          or p.nombre ilike '%'||p_busqueda||'%')),
    'filas',coalesce((select jsonb_agg(to_jsonb(t) order by t.edificio,t.unidad,t.periodo nulls first) from (
      select h.id,u.edificio,u.numero as unidad,p.nombre,h.tipo,h.periodo,h.monto,h.destino,
        h.fuente,h.fecha_pago,h.forma_pago,h.referencia,h.editado_at
      from echo_privado.operaciones_historial_m60 h
      join public.unidades u on u.id=h.unidad_id
      left join echo_privado.operaciones_propietarios p on p.condominio_id=3
        and p.clave='M'||u.edificio||'-'||u.numero
      where u.condominio_id=3 and ((p_anio=0 and h.tipo='fondo_cadu') or
        (h.tipo='mensualidad' and h.periodo>=make_date(greatest(p_anio,1),1,1) and h.periodo<make_date(greatest(p_anio,1)+1,1,1)))
        and (coalesce(p_edificio,'')='' or u.edificio=p_edificio)
        and (coalesce(p_busqueda,'')='' or u.identificador ilike '%'||p_busqueda||'%'
          or p.nombre ilike '%'||p_busqueda||'%')
      order by u.edificio,u.numero,h.periodo nulls first limit 100 offset p_offset
    ) t),'[]'::jsonb));
end;
$$;
