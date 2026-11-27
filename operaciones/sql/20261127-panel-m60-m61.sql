-- Clave del archivo de CADU, separada de la clave estable del padrón de Echo.
alter table echo_privado.operaciones_propietarios add column if not exists clave_cadu text;
create unique index if not exists operaciones_propietarios_clave_cadu_unica
  on echo_privado.operaciones_propietarios(condominio_id,clave_cadu) where clave_cadu is not null;

create or replace function public.pg_operaciones_panel_m60(
  p_user text,p_password text,p_condominio bigint,p_anio integer default 2026
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio)
    or p_anio not between 2022 and 2100 then
    return jsonb_build_object('ok',false,'error','Acceso o año inválidos.');
  end if;
  return jsonb_build_object('ok',true,
    'unidades',coalesce((select jsonb_agg(to_jsonb(x) order by x.edificio,x.numero) from (
      select u.id,u.edificio,u.numero,p.nombre,p.clave_cadu,p.email,p.whatsapp,
        exists(select 1 from echo_privado.operaciones_historial_m60 f
          where f.unidad_id=u.id and f.tipo='fondo_cadu') as fondo_cadu,
        coalesce((select jsonb_object_agg(extract(month from h.periodo)::integer::text,
          jsonb_build_object('destino',h.destino,'fecha_pago',h.fecha_pago))
          from echo_privado.operaciones_historial_m60 h
          where h.unidad_id=u.id and h.tipo='mensualidad'
            and h.periodo>=make_date(p_anio,1,1) and h.periodo<make_date(p_anio+1,1,1)),'{}'::jsonb) as pagos
      from public.unidades u
      left join lateral (
        select p.nombre,p.clave_cadu,p.email,p.whatsapp
        from echo_privado.operaciones_titularidades t
        join echo_privado.operaciones_propietarios p on p.id=t.propietario_id
        where t.unidad_id=u.id and p.condominio_id=3 order by p.id limit 1
      ) p on true
      where u.condominio_id=3 and u.activa
    ) x),'[]'::jsonb));
end;
$$;
revoke all on function public.pg_operaciones_panel_m60(text,text,bigint,integer) from public;
grant execute on function public.pg_operaciones_panel_m60(text,text,bigint,integer) to anon,authenticated;

create table if not exists echo_privado.operaciones_descuentos_m60_config (
  condominio_id bigint primary key references public.condominios(id),
  habilitado boolean not null default false,
  mensaje text not null,
  actualizado_por text,
  actualizado_at timestamptz
);
create table if not exists echo_privado.operaciones_descuentos_m60 (
  id bigint generated always as identity primary key,
  condominio_id bigint not null references public.condominios(id),
  negocio text not null,
  descuento text not null,
  vigencia text,
  activo boolean not null default true,
  creado_por text not null,
  creado_at timestamptz not null default now()
);
alter table echo_privado.operaciones_descuentos_m60_config enable row level security;
alter table echo_privado.operaciones_descuentos_m60 enable row level security;
revoke all on echo_privado.operaciones_descuentos_m60_config,echo_privado.operaciones_descuentos_m60 from public,anon,authenticated;
insert into echo_privado.operaciones_descuentos_m60_config(condominio_id,mensaje)
values (3,'Hola, somos Echo Administración de las manzanas 60 y 61. ¿Te gustaría que agreguemos descuentos y convenios para nuestra comunidad? Si tienes un negocio o conoces alguno que quiera ofrecer un beneficio a los propietarios, compártenos su nombre y propuesta. ¡Gracias!')
on conflict (condominio_id) do nothing;

create or replace function public.pg_operaciones_descuentos_m60(
  p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  accion text := p_cambio->>'accion';
  v_id bigint;
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if p_cambio is not null then
    if accion='configurar' then
      if jsonb_typeof(p_cambio->'habilitado')<>'boolean'
        or char_length(btrim(coalesce(p_cambio->>'mensaje',''))) not between 20 and 1000 then
        return jsonb_build_object('ok',false,'error','Completa la opción y el mensaje.');
      end if;
      update echo_privado.operaciones_descuentos_m60_config
      set habilitado=(p_cambio->>'habilitado')::boolean,mensaje=btrim(p_cambio->>'mensaje'),
        actualizado_por=admin.user_id,actualizado_at=now() where condominio_id=3;
    elsif accion='agregar' then
      if not (select habilitado from echo_privado.operaciones_descuentos_m60_config where condominio_id=3)
        or char_length(btrim(coalesce(p_cambio->>'negocio',''))) not between 2 and 100
        or char_length(btrim(coalesce(p_cambio->>'descuento',''))) not between 3 and 250
        or char_length(coalesce(p_cambio->>'vigencia',''))>150 then
        return jsonb_build_object('ok',false,'error','Activa la sección y completa negocio y descuento.');
      end if;
      insert into echo_privado.operaciones_descuentos_m60(condominio_id,negocio,descuento,vigencia,creado_por)
      values (3,btrim(p_cambio->>'negocio'),btrim(p_cambio->>'descuento'),
        nullif(btrim(p_cambio->>'vigencia'),''),admin.user_id);
    elsif accion='estado' then
      if coalesce(p_cambio->>'id','') !~ '^[0-9]{1,16}$' or jsonb_typeof(p_cambio->'activo')<>'boolean' then
        return jsonb_build_object('ok',false,'error','Descuento inválido.');
      end if;
      update echo_privado.operaciones_descuentos_m60 set activo=(p_cambio->>'activo')::boolean
      where id=(p_cambio->>'id')::bigint and condominio_id=3;
      if not found then return jsonb_build_object('ok',false,'error','Descuento no encontrado.'); end if;
    else
      return jsonb_build_object('ok',false,'error','Acción inválida.');
    end if;
  end if;
  return jsonb_build_object('ok',true,
    'config',(select to_jsonb(c)-'condominio_id' from echo_privado.operaciones_descuentos_m60_config c where c.condominio_id=3),
    'descuentos',coalesce((select jsonb_agg(to_jsonb(d)-'condominio_id' order by d.id desc)
      from echo_privado.operaciones_descuentos_m60 d where d.condominio_id=3),'[]'::jsonb));
end;
$$;
revoke all on function public.pg_operaciones_descuentos_m60(text,text,bigint,jsonb) from public;
grant execute on function public.pg_operaciones_descuentos_m60(text,text,bigint,jsonb) to anon,authenticated;
