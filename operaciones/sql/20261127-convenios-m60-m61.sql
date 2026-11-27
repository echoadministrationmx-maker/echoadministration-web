-- Convenios de M60/M61 y tres opciones comerciales administrables.
create table if not exists echo_privado.operaciones_planes_m60 (
  id smallint primary key check (id between 1 and 3),
  titulo text not null,
  descripcion text not null,
  descuento_porcentaje numeric(5,2) not null default 0 check (descuento_porcentaje between 0 and 100),
  activo boolean not null default false,
  actualizado_at timestamptz not null default now()
);
insert into echo_privado.operaciones_planes_m60(id,titulo,descripcion,descuento_porcentaje,activo)
values (1,'Pago anual anticipado','10% de descuento al pagar 12 mensualidades por anticipado. Cuota base: $500 por mes.',10,true),
 (2,'Opción de convenio 2','Define las condiciones antes de ofrecer este plan.',0,false),
 (3,'Opción de convenio 3','Define las condiciones antes de ofrecer este plan.',0,false)
on conflict (id) do nothing;
create table if not exists echo_privado.operaciones_convenios_m60 (
 id bigint generated always as identity primary key,
 condominio_id bigint not null references public.condominios(id),
 unidad_id bigint not null references public.unidades(id),
 plan_id smallint references echo_privado.operaciones_planes_m60(id),
 tipo text not null,
 saldo_confirmado numeric(12,2) not null check (saldo_confirmado >= 0),
 monto_acordado numeric(12,2) not null check (monto_acordado > 0),
 abono_mensual numeric(12,2) check (abono_mensual > 0),
 proximo_pago date,
 condiciones text not null default '',
 estado text not null default 'activo' check (estado in ('activo','cumplido','cancelado')),
 creado_por text not null,
 creado_at timestamptz not null default now(),
 actualizado_at timestamptz not null default now()
);
create unique index if not exists operaciones_convenios_m60_activo_unidad
 on echo_privado.operaciones_convenios_m60(unidad_id) where estado='activo';
create index if not exists operaciones_convenios_m60_cond_estado
 on echo_privado.operaciones_convenios_m60(condominio_id,estado);
alter table echo_privado.operaciones_planes_m60 enable row level security;
alter table echo_privado.operaciones_convenios_m60 enable row level security;
revoke all on echo_privado.operaciones_planes_m60,echo_privado.operaciones_convenios_m60 from public,anon,authenticated;

create or replace function public.pg_operaciones_convenios_m60(
 p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
 accion text := p_cambio->>'accion'; v_id bigint; v_plan smallint; v_tipo text; v_cond text;
 v_saldo numeric; v_monto numeric; v_abono numeric; v_fecha date;
begin
 if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
   return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
 end if;
 if p_cambio is not null then
   if accion='plan' then
     if coalesce(p_cambio->>'id','') !~ '^[1-3]$' or jsonb_typeof(p_cambio->'activo')<>'boolean'
       or char_length(btrim(coalesce(p_cambio->>'titulo',''))) not between 3 and 100
       or char_length(btrim(coalesce(p_cambio->>'descripcion',''))) not between 12 and 1000
       or coalesce(p_cambio->>'descuento','') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
       or (p_cambio->>'descuento')::numeric > 100 then
       return jsonb_build_object('ok',false,'error','Revisa el título, condiciones y porcentaje del plan.');
     end if;
     v_plan := (p_cambio->>'id')::smallint;
     -- Mantener la oferta anual fija que autorizó la administración.
     if v_plan=1 and ((p_cambio->>'descuento')::numeric<>10 or (p_cambio->>'activo')::boolean=false) then
       return jsonb_build_object('ok',false,'error','La oferta anual autorizada es de 10%.');
     end if;
     update echo_privado.operaciones_planes_m60 set titulo=btrim(p_cambio->>'titulo'),
       descripcion=btrim(p_cambio->>'descripcion'),descuento_porcentaje=(p_cambio->>'descuento')::numeric,
       activo=(p_cambio->>'activo')::boolean,actualizado_at=now() where id=v_plan;
   elsif accion='crear' then
     if coalesce(p_cambio->>'unidad','') !~ '^[0-9]{1,16}$'
       or coalesce(p_cambio->>'plan','') !~ '^[1-3]$'
       or coalesce(p_cambio->>'saldo','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
       or coalesce(p_cambio->>'monto','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
       or coalesce(p_cambio->>'abono','') !~ '^([0-9]{1,9}(\.[0-9]{1,2})?)?$'
       or char_length(coalesce(p_cambio->>'condiciones',''))>2000 then
       return jsonb_build_object('ok',false,'error','Revisa unidad e importes del acuerdo.');
     end if;
     v_id:=(p_cambio->>'unidad')::bigint;v_plan:=(p_cambio->>'plan')::smallint;
     v_saldo:=(p_cambio->>'saldo')::numeric;v_monto:=(p_cambio->>'monto')::numeric;
     v_abono:=nullif(p_cambio->>'abono','')::numeric;
     v_cond:=btrim(coalesce(p_cambio->>'condiciones',''));
     if coalesce(p_cambio->>'fecha','')<>'' then
       begin v_fecha:=(p_cambio->>'fecha')::date;exception when others then
         return jsonb_build_object('ok',false,'error','Fecha inválida.'); end;
     end if;
     if v_monto<=0 or (v_abono is not null and v_abono<=0)
       or not exists(select 1 from public.unidades u where u.id=v_id and u.condominio_id=3 and u.activa)
       or not exists(select 1 from echo_privado.operaciones_planes_m60 p where p.id=v_plan and p.activo) then
       return jsonb_build_object('ok',false,'error','Unidad, plan o importes inválidos.');
     end if;
     if exists(select 1 from echo_privado.operaciones_convenios_m60 c where c.unidad_id=v_id and c.estado='activo') then
       return jsonb_build_object('ok',false,'error','La unidad ya tiene un convenio activo.');
     end if;
     select titulo into v_tipo from echo_privado.operaciones_planes_m60 where id=v_plan;
     insert into echo_privado.operaciones_convenios_m60(condominio_id,unidad_id,plan_id,tipo,saldo_confirmado,monto_acordado,abono_mensual,proximo_pago,condiciones,creado_por)
     values (3,v_id,v_plan,v_tipo,v_saldo,v_monto,v_abono,v_fecha,v_cond,admin.user_id);
   elsif accion='estado' then
     if coalesce(p_cambio->>'id','') !~ '^[0-9]{1,16}$' or coalesce(p_cambio->>'estado','') not in ('activo','cumplido','cancelado') then
       return jsonb_build_object('ok',false,'error','Estado inválido.');
     end if;
     update echo_privado.operaciones_convenios_m60 set estado=p_cambio->>'estado',actualizado_at=now()
       where id=(p_cambio->>'id')::bigint and condominio_id=3;
     if not found then return jsonb_build_object('ok',false,'error','Convenio no encontrado.'); end if;
   else return jsonb_build_object('ok',false,'error','Acción inválida.');
   end if;
 end if;
 return jsonb_build_object('ok',true,
   'planes',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from echo_privado.operaciones_planes_m60 p),'[]'::jsonb),
   'convenios',coalesce((select jsonb_agg(to_jsonb(x) order by x.creado_at desc,x.id desc) from (
     select c.id,c.unidad_id,c.plan_id,c.tipo,c.saldo_confirmado,c.monto_acordado,c.abono_mensual,c.proximo_pago,c.condiciones,c.estado,c.creado_por,c.creado_at,
       u.edificio,u.numero,p.nombre
     from echo_privado.operaciones_convenios_m60 c join public.unidades u on u.id=c.unidad_id
     left join lateral (select pr.nombre from echo_privado.operaciones_titularidades t
       join echo_privado.operaciones_propietarios pr on pr.id=t.propietario_id
       where t.unidad_id=u.id and pr.condominio_id=3 order by pr.id limit 1) p on true
     where c.condominio_id=3
   ) x),'[]'::jsonb));
end;
$$;
revoke all on function public.pg_operaciones_convenios_m60(text,text,bigint,jsonb) from public;
grant execute on function public.pg_operaciones_convenios_m60(text,text,bigint,jsonb) to anon,authenticated;
