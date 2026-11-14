begin;
create schema if not exists echo_privado;
create table echo_privado.cambios_propietario (
  id bigint generated always as identity primary key,
  id_residente integer not null references public.residentes(id_residente),
  tipo text not null check (tipo in ('venta','traspaso')),
  anterior text not null,
  nuevo text not null,
  fecha date not null,
  registrado_por text not null,
  registrado_at timestamptz not null default now()
);
alter table echo_privado.cambios_propietario enable row level security;
create index cambios_propietario_unidad_idx on echo_privado.cambios_propietario(id_residente, id desc);
create function public.pg_cambios_propietario(
  p_user text, p_password text, p_id_residente integer,
  p_tipo text default null, p_anterior text default null,
  p_nuevo text default null, p_fecha date default null, p_ultimo bigint default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  hash text;
  unidad public.residentes%rowtype;
  ultimo echo_privado.cambios_propietario%rowtype;
  anterior text;
begin
  select password_hash into hash from public.admins where user_id = p_user limit 1;
  if hash is null or p_password is null or extensions.crypt(p_password, hash) is distinct from hash then
    return jsonb_build_object('ok', false, 'error', 'Acceso no autorizado.');
  end if;
  if p_tipo is null then
    select * into unidad from public.residentes where id_residente = p_id_residente;
  else
    select * into unidad from public.residentes where id_residente = p_id_residente for update;
  end if;
  if not found then return jsonb_build_object('ok', false, 'error', 'No se encontró la unidad.'); end if;
  select * into ultimo from echo_privado.cambios_propietario
    where id_residente = p_id_residente order by id desc limit 1;
  if p_tipo is not null then
    if ultimo.id is distinct from p_ultimo then
      return jsonb_build_object('ok', false, 'error', 'La unidad cambió. Cierra y vuelve a abrir la ficha.');
    end if;
    anterior := coalesce(ultimo.nuevo, nullif(btrim(p_anterior), ''));
    if p_tipo not in ('venta','traspaso') or anterior is null or char_length(anterior) > 200
      or nullif(btrim(p_nuevo), '') is null or char_length(btrim(p_nuevo)) > 200
      or lower(anterior) = lower(btrim(p_nuevo)) or p_fecha is null
      or p_fecha > (now() at time zone 'America/Cancun')::date
      or (ultimo.fecha is not null and p_fecha < ultimo.fecha) then
      return jsonb_build_object('ok', false, 'error', 'Revisa los nombres y la fecha del movimiento.');
    end if;
    insert into echo_privado.cambios_propietario(id_residente,tipo,anterior,nuevo,fecha,registrado_por)
      values (p_id_residente,p_tipo,anterior,btrim(p_nuevo),p_fecha,p_user);
  end if;
  return jsonb_build_object('ok', true, 'historial', coalesce((
    select jsonb_agg(to_jsonb(c) order by c.id desc)
    from echo_privado.cambios_propietario c where c.id_residente = p_id_residente
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.pg_cambios_propietario(text,text,integer,text,text,text,date,bigint) from public;
grant execute on function public.pg_cambios_propietario(text,text,integer,text,text,text,date,bigint) to anon, authenticated;
commit;