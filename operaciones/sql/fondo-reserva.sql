begin;

-- One-time reserve contribution. No monthly maintenance charges are created or changed.
create table if not exists public.aportaciones_fondo_reserva (
 id_residente integer primary key references public.residentes(id_residente),
 monto numeric(12,2) not null default 1000 check(monto=1000),
 fecha_pago date not null,
 referencia text not null check(length(trim(referencia)) between 1 and 200),
 forma_pago text not null,
 folio bigint not null references public.recibos(folio),
 registrado_por text not null,
 registrado_at timestamptz not null default now()
);
alter table public.aportaciones_fondo_reserva
 alter column fecha_pago drop not null,
 alter column referencia drop not null,
 alter column forma_pago drop not null,
 alter column folio drop not null,
 add column if not exists pago_confirmado_sin_recibo boolean not null default false;

alter table public.aportaciones_fondo_reserva enable row level security;
revoke all on public.aportaciones_fondo_reserva from public,anon,authenticated;

create or replace function public.pg_fondo_reserva(p_user text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare h text;
begin
 select password_hash into h from public.admins where user_id=p_user limit 1;
 if h is null or p_password is null or extensions.crypt(p_password,h) is distinct from h then return jsonb_build_object('ok',false); end if;
 return jsonb_build_object('ok',true,'cuota',1000,'residentes',coalesce((
 with unidades as (
 select r.id_residente, r.num, r.departamento, r.nombre_completo, r.condominio_id, a.monto, a.fecha_pago, a.referencia, case when rc.estado='activo' then a.folio end as folio, a.forma_pago, a.registrado_por,
        a.registrado_at, c.nombre as condominio,
        a.id_residente is not null and (a.pago_confirmado_sin_recibo or a.folio is null or rc.estado='activo') as pagado
 from public.residentes r
 left join public.aportaciones_fondo_reserva a on a.id_residente=r.id_residente
 left join public.recibos rc on rc.folio=a.folio
 left join public.condominios c on c.id=r.condominio_id
 where coalesce(trim(r.num),'')<>'' and exists(
  select 1 from public.admins admin where admin.user_id=p_user and
  (admin.rol='plataforma' or r.condominio_id=admin.condominio_id
   or r.condominio_id=any(coalesce(admin.condominios_permitidos,'{}'::integer[])))
 )
 )
 select jsonb_agg(jsonb_build_object('id_residente',r.id_residente,'edificio',trim(r.num),'departamento',r.departamento,
 'condominio_id',r.condominio_id,'condominio',r.condominio,
 'nombre_completo',r.nombre_completo,'pagado',r.pagado,'monto',case when r.pagado then r.monto else 0 end,
 'fecha_pago',case when r.pagado then r.fecha_pago end,'referencia',case when r.pagado then r.referencia end,
 'folio',case when r.pagado then r.folio end,'forma_pago',case when r.pagado then r.forma_pago end,
 'registrado_por',case when r.pagado then r.registrado_por end,
 'registrado_at',case when r.pagado then r.registrado_at end) order by trim(r.num),r.departamento)
 from unidades r),'[]'::jsonb));
end; $$;

create or replace function public.pg_registrar_fondo_reserva(p_user text,p_password text,p_id_residente integer,p_fecha_pago date,p_referencia text,p_forma_pago text,p_confirmado boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare h text; recibo json; conceptos jsonb;
begin
 select password_hash into h from public.admins where user_id=p_user limit 1;
 if h is null or p_password is null or extensions.crypt(p_password,h) is distinct from h then return jsonb_build_object('ok',false,'error','Acceso no autorizado'); end if;
 if p_confirmado is distinct from true then return jsonb_build_object('ok',false,'error','Confirma la revisión del comprobante y la unidad'); end if;
 if p_fecha_pago is null or p_fecha_pago>(now() at time zone 'America/Cancun')::date then return jsonb_build_object('ok',false,'error','Fecha de pago no válida'); end if;
 if p_referencia is null or length(trim(p_referencia)) not between 1 and 200 then return jsonb_build_object('ok',false,'error','Ingresa una referencia de 1 a 200 caracteres'); end if;
 if p_forma_pago is null or p_forma_pago not in ('Transferencia','Dep. en efectivo','Efectivo','Mercado Pago') then return jsonb_build_object('ok',false,'error','Forma de pago no válida'); end if;
 if not exists(select 1 from public.residentes where id_residente=p_id_residente and coalesce(trim(num),'')<>'' and exists(select 1 from public.admins a where a.user_id=p_user and (a.rol='plataforma' or residentes.condominio_id=a.condominio_id or residentes.condominio_id=any(coalesce(a.condominios_permitidos,'{}'::integer[]))))) then return jsonb_build_object('ok',false,'error','Unidad no encontrada'); end if;
 -- Serialize retries and concurrent registrations for the same unit.
 perform pg_advisory_xact_lock(1000,p_id_residente);
 if exists(select 1 from public.aportaciones_fondo_reserva a left join public.recibos rc on rc.folio=a.folio where a.id_residente=p_id_residente and (a.pago_confirmado_sin_recibo or a.folio is null or rc.estado='activo')) then
 return jsonb_build_object('ok',false,'error','Esta unidad ya tiene el fondo registrado. Actualiza la consulta para ver el registro'); end if;
 conceptos:=jsonb_build_array(jsonb_build_object('c','Fondo de reserva · cuota única','m',1000,'tipo','fondo_reserva','fecha_pago',p_fecha_pago,'referencia',trim(p_referencia)));
 recibo:=public.pg_emitir_recibo(p_user,p_password,p_id_residente,conceptos,1000,p_forma_pago);
 if coalesce((recibo->>'ok')::boolean,false) is not true then raise exception 'No se pudo emitir el comprobante del fondo'; end if;
 insert into public.aportaciones_fondo_reserva(id_residente,monto,fecha_pago,referencia,forma_pago,folio,registrado_por)
 values(p_id_residente,1000,p_fecha_pago,trim(p_referencia),p_forma_pago,(recibo->>'folio')::bigint,p_user)
 on conflict(id_residente) do update set monto=1000,fecha_pago=excluded.fecha_pago,referencia=excluded.referencia,forma_pago=excluded.forma_pago,folio=excluded.folio,registrado_por=excluded.registrado_por,registrado_at=now();
 return recibo::jsonb||jsonb_build_object('conceptos',conceptos,'fecha_pago',p_fecha_pago);
end; $$;
revoke all on function public.pg_fondo_reserva(text,text) from public;
revoke all on function public.pg_registrar_fondo_reserva(text,text,integer,date,text,text,boolean) from public;
grant execute on function public.pg_fondo_reserva(text,text) to anon,authenticated;
grant execute on function public.pg_registrar_fondo_reserva(text,text,integer,date,text,text,boolean) to anon,authenticated;

create or replace function public.pg_marcar_fondo_reserva_pagado(
 p_user text, p_password text, p_id_residente integer, p_confirmado boolean
)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
 h text;
 registro timestamptz;
begin
 select password_hash into h from public.admins where user_id=p_user limit 1;
 if h is null or p_password is null or extensions.crypt(p_password,h) is distinct from h then
  return jsonb_build_object('ok',false,'error','Acceso no autorizado');
 end if;
 if p_confirmado is distinct from true then
  return jsonb_build_object('ok',false,'error','Confirma que la unidad ya pagó el fondo');
 end if;
 if not exists(
  select 1 from public.residentes r where r.id_residente=p_id_residente
  and coalesce(trim(r.num),'')<>'' and exists(
   select 1 from public.admins a where a.user_id=p_user and
   (a.rol='plataforma' or r.condominio_id=a.condominio_id
    or r.condominio_id=any(coalesce(a.condominios_permitidos,'{}'::integer[])))
  )
 ) then
  return jsonb_build_object('ok',false,'error','Unidad no encontrada');
 end if;

 perform pg_advisory_xact_lock(1000,p_id_residente);
 select a.registrado_at into registro
 from public.aportaciones_fondo_reserva a
 left join public.recibos rc on rc.folio=a.folio
 where a.id_residente=p_id_residente and (a.pago_confirmado_sin_recibo or a.folio is null or rc.estado='activo');
 if found then
  return jsonb_build_object('ok',true,'ya_registrado',true,'registrado_at',registro);
 end if;

 insert into public.aportaciones_fondo_reserva(id_residente,monto,registrado_por,pago_confirmado_sin_recibo)
 values(p_id_residente,1000,p_user,true)
 on conflict(id_residente) do update set
  monto=excluded.monto, fecha_pago=null, referencia=null, forma_pago=null, folio=null,
  registrado_por=excluded.registrado_por, registrado_at=excluded.registrado_at,
  pago_confirmado_sin_recibo=true
 returning registrado_at into registro;
 return jsonb_build_object('ok',true,'registrado_at',registro);
end; $$;
revoke all on function public.pg_marcar_fondo_reserva_pagado(text,text,integer,boolean) from public;
grant execute on function public.pg_marcar_fondo_reserva_pagado(text,text,integer,boolean) to anon,authenticated;

create or replace function public.pg_emitir_recibo_fondo_reserva(
 p_user text, p_password text, p_id_residente integer, p_fecha_pago date, p_forma_pago text
)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
 h text;
 aporte public.aportaciones_fondo_reserva%rowtype;
 recibo json;
begin
 select password_hash into h from public.admins where user_id=p_user limit 1;
 if h is null or p_password is null or extensions.crypt(p_password,h) is distinct from h then
  return jsonb_build_object('ok',false,'error','Acceso no autorizado');
 end if;
 if not exists(
  select 1 from public.residentes r join public.admins a on a.user_id=p_user
  where r.id_residente=p_id_residente and nullif(trim(r.num),'') is not null
  and (a.rol='plataforma' or r.condominio_id=a.condominio_id
       or r.condominio_id=any(coalesce(a.condominios_permitidos,'{}'::integer[])))
 ) then
  return jsonb_build_object('ok',false,'error','Unidad no encontrada');
 end if;
 perform pg_advisory_xact_lock(1000,p_id_residente);
 select * into aporte from public.aportaciones_fondo_reserva where id_residente=p_id_residente for update;
 if not found then
  return jsonb_build_object('ok',false,'error','Primero registra el pago del fondo');
 end if;
 if exists(select 1 from public.recibos where folio=aporte.folio and estado='activo') then
  return jsonb_build_object('ok',true,'folio',aporte.folio,'fecha_pago',aporte.fecha_pago,'forma_pago',aporte.forma_pago);
 end if;
 if aporte.folio is not null and not aporte.pago_confirmado_sin_recibo then
  return jsonb_build_object('ok',false,'error','Primero registra el pago del fondo');
 end if;
 if p_fecha_pago is null or p_fecha_pago>(now() at time zone 'America/Cancun')::date then
  return jsonb_build_object('ok',false,'error','Indica una fecha de pago válida');
 end if;
 if p_forma_pago is null or p_forma_pago not in ('Transferencia','Dep. en efectivo','Efectivo','Mercado Pago') then
  return jsonb_build_object('ok',false,'error','Selecciona una forma de pago');
 end if;

 recibo:=public.pg_emitir_recibo(p_user,p_password,p_id_residente,
  jsonb_build_array(jsonb_build_object('c','Fondo de reserva · cuota única','m',aporte.monto,
   'tipo','fondo_reserva','fecha_pago',p_fecha_pago)),aporte.monto,p_forma_pago);
 if (recibo->>'ok')::boolean is distinct from true then
  raise exception 'No se pudo emitir el comprobante del fondo';
 end if;
 update public.aportaciones_fondo_reserva
 set folio=(recibo->>'folio')::bigint,fecha_pago=p_fecha_pago,forma_pago=p_forma_pago,
     pago_confirmado_sin_recibo=true
 where id_residente=p_id_residente;
 return jsonb_build_object('ok',true,'folio',recibo->'folio','fecha_pago',p_fecha_pago,'forma_pago',p_forma_pago);
end; $$;
revoke all on function public.pg_emitir_recibo_fondo_reserva(text,text,integer,date,text) from public;
grant execute on function public.pg_emitir_recibo_fondo_reserva(text,text,integer,date,text) to anon,authenticated;

notify pgrst, 'reload schema';
commit;
