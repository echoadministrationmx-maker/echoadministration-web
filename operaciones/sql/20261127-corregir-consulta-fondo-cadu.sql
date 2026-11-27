-- Corrección del filtro de fondo, que usa año 0 como selector.
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

