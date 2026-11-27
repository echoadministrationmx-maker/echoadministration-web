-- Historial entregado por CADU: la fecha exacta de cada pago no consta en el archivo.
create table if not exists echo_privado.operaciones_historial_m60 (
  id bigint generated always as identity primary key,
  unidad_id bigint not null references public.unidades(id),
  tipo text not null check (tipo in ('mensualidad','fondo_cadu')),
  periodo date,
  monto integer not null check (monto > 0),
  destino text not null check (char_length(btrim(destino)) between 2 and 80),
  fuente text not null,
  editado_por text,
  editado_at timestamptz,
  unique nulls not distinct (unidad_id,tipo,periodo),
  check ((tipo='mensualidad' and periodo is not null) or (tipo='fondo_cadu' and periodo is null))
);
create index if not exists operaciones_historial_m60_periodo_idx
  on echo_privado.operaciones_historial_m60(periodo,unidad_id);
create table if not exists echo_privado.operaciones_historial_m60_ediciones (
  id bigint generated always as identity primary key,
  historial_id bigint not null references echo_privado.operaciones_historial_m60(id),
  destino_anterior text not null,
  destino_nuevo text not null,
  editado_por text not null,
  editado_at timestamptz not null default now()
);
alter table echo_privado.operaciones_historial_m60 enable row level security;
alter table echo_privado.operaciones_historial_m60_ediciones enable row level security;
revoke all on echo_privado.operaciones_historial_m60,echo_privado.operaciones_historial_m60_ediciones from public,anon,authenticated;

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
      select h.id,u.edificio,u.numero as unidad,p.nombre,h.tipo,h.periodo,h.monto,h.destino,h.fuente,h.editado_at
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

create or replace function public.pg_operaciones_editar_destino_m60(
  p_user text,p_password text,p_condominio bigint,p_id bigint,p_destino text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  anterior text;
  nuevo text := btrim(p_destino);
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio)
    or char_length(nuevo) not between 2 and 80 then
    return jsonb_build_object('ok',false,'error','Acceso o destino inválidos.');
  end if;
  select h.destino into anterior from echo_privado.operaciones_historial_m60 h
  join public.unidades u on u.id=h.unidad_id
  where h.id=p_id and u.condominio_id=p_condominio and h.tipo='mensualidad' for update of h;
  if not found then return jsonb_build_object('ok',false,'error','Mensualidad no encontrada.'); end if;
  if anterior<>nuevo then
    update echo_privado.operaciones_historial_m60 set destino=nuevo,editado_por=admin.user_id,editado_at=now()
    where id=p_id;
    insert into echo_privado.operaciones_historial_m60_ediciones(historial_id,destino_anterior,destino_nuevo,editado_por)
    values(p_id,anterior,nuevo,admin.user_id);
  end if;
  return jsonb_build_object('ok',true,'destino',nuevo);
end;
$$;
revoke all on function public.pg_operaciones_historial_m60(text,text,bigint,integer,text,text,integer) from public;
revoke all on function public.pg_operaciones_editar_destino_m60(text,text,bigint,bigint,text) from public;
grant execute on function public.pg_operaciones_historial_m60(text,text,bigint,integer,text,text,integer) to anon,authenticated;
grant execute on function public.pg_operaciones_editar_destino_m60(text,text,bigint,bigint,text) to anon,authenticated;
