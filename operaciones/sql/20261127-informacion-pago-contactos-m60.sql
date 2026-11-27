create table if not exists echo_privado.operaciones_pago_info_m60 (
  condominio_id bigint primary key references public.condominios(id),
  cuota_mensual integer not null check (cuota_mensual>0),
  banco text not null,
  clabe text not null check (clabe ~ '^[0-9]{18}$'),
  cuenta_deposito text not null,
  correo_comprobantes text not null,
  correo_contacto text not null,
  telefono_contacto text not null,
  actualizado_por text,
  actualizado_at timestamptz
);
alter table echo_privado.operaciones_pago_info_m60 enable row level security;
revoke all on echo_privado.operaciones_pago_info_m60 from public,anon,authenticated;
insert into echo_privado.operaciones_pago_info_m60
  (condominio_id,cuota_mensual,banco,clabe,cuenta_deposito,correo_comprobantes,correo_contacto,telefono_contacto)
values (3,500,'Banamex','002694004900506124','004950612',
  'ac.mzn6061.admin@gmail.com','aldeatulum.mza60@gmail.com','9842352241')
on conflict (condominio_id) do nothing;

create or replace function public.pg_informacion_pago_m60()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select coalesce((select jsonb_build_object(
    'cuota_mensual',i.cuota_mensual,'banco',i.banco,'clabe',i.clabe,
    'cuenta_deposito',i.cuenta_deposito,'correo_comprobantes',i.correo_comprobantes,
    'correo_contacto',i.correo_contacto,'telefono_contacto',i.telefono_contacto)
    from echo_privado.operaciones_pago_info_m60 i
    join public.condominios c on c.id=i.condominio_id
    where c.codigo='M60' and c.activo),'{}'::jsonb);
$$;
revoke all on function public.pg_informacion_pago_m60() from public;
grant execute on function public.pg_informacion_pago_m60() to anon,authenticated;

create or replace function public.pg_operaciones_pago_info_m60(
  p_user text,p_password text,p_condominio bigint,p_cambio jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  correo text := lower(btrim(p_cambio->>'correo_contacto'));
  comprobantes text := lower(btrim(p_cambio->>'correo_comprobantes'));
  telefono text := btrim(p_cambio->>'telefono_contacto');
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if p_cambio is not null then
    if coalesce(char_length(correo),0)>254 or coalesce(correo,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or coalesce(char_length(comprobantes),0)>254 or coalesce(comprobantes,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or coalesce(char_length(telefono),0)>25
      or regexp_replace(coalesce(telefono,''),'[^0-9]','','g') !~ '^[0-9]{7,15}$' then
      return jsonb_build_object('ok',false,'error','Revisa los correos y el número de contacto.');
    end if;
    update echo_privado.operaciones_pago_info_m60
    set correo_contacto=correo,correo_comprobantes=comprobantes,telefono_contacto=telefono,
      actualizado_por=admin.user_id,actualizado_at=now() where condominio_id=3;
  end if;
  return jsonb_build_object('ok',true,'datos',
    (select to_jsonb(i)-'condominio_id' from echo_privado.operaciones_pago_info_m60 i where i.condominio_id=3));
end;
$$;
revoke all on function public.pg_operaciones_pago_info_m60(text,text,bigint,jsonb) from public;
grant execute on function public.pg_operaciones_pago_info_m60(text,text,bigint,jsonb) to anon,authenticated;

create table if not exists echo_privado.operaciones_contacto_ediciones_m60 (
  id bigint generated always as identity primary key,
  propietario_id bigint not null references echo_privado.operaciones_propietarios(id),
  anterior jsonb not null,
  nuevo jsonb not null,
  editado_por text not null,
  editado_at timestamptz not null default now()
);
alter table echo_privado.operaciones_contacto_ediciones_m60 enable row level security;
revoke all on echo_privado.operaciones_contacto_ediciones_m60 from public,anon,authenticated;

create or replace function public.pg_operaciones_contacto_propietario_m60(
  p_user text,p_password text,p_condominio bigint,p_clave text,
  p_email text,p_telefono text,p_whatsapp text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare admin public.admins := echo_privado.operaciones_admin(p_user,p_password);
  ficha echo_privado.operaciones_propietarios%rowtype;
  correo text := nullif(lower(btrim(p_email)),'');
  v_telefono text := nullif(btrim(p_telefono),'');
  v_whatsapp text := nullif(btrim(p_whatsapp),'');
  anterior jsonb;
  nuevo jsonb;
begin
  if p_condominio<>3 or not echo_privado.operaciones_acceso(admin,p_condominio) then
    return jsonb_build_object('ok',false,'error','Acceso no autorizado.');
  end if;
  if (correo is not null and (char_length(correo)>254 or correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    or char_length(coalesce(v_telefono,''))>30 or char_length(coalesce(v_whatsapp,''))>30
    or (v_telefono is not null and regexp_replace(v_telefono,'[^0-9]','','g') !~ '^[0-9]{7,15}$')
    or (v_whatsapp is not null and regexp_replace(v_whatsapp,'[^0-9]','','g') !~ '^[0-9]{7,15}$') then
    return jsonb_build_object('ok',false,'error','Revisa el correo y los números de contacto.');
  end if;
  select * into ficha from echo_privado.operaciones_propietarios
  where condominio_id=3 and clave=p_clave for update;
  if not found then return jsonb_build_object('ok',false,'error','Propietario no encontrado.'); end if;
  anterior:=jsonb_build_object('email',ficha.email,'telefono',ficha.telefono,'whatsapp',ficha.whatsapp);
  nuevo:=jsonb_build_object('email',correo,'telefono',v_telefono,'whatsapp',v_whatsapp);
  if anterior is distinct from nuevo then
    update echo_privado.operaciones_propietarios
    set email=correo,telefono=v_telefono,whatsapp=v_whatsapp where id=ficha.id;
    insert into echo_privado.operaciones_contacto_ediciones_m60(propietario_id,anterior,nuevo,editado_por)
    values (ficha.id,anterior,nuevo,admin.user_id);
  end if;
  return jsonb_build_object('ok',true,'contacto',nuevo);
end;
$$;
revoke all on function public.pg_operaciones_contacto_propietario_m60(text,text,bigint,text,text,text,text) from public;
grant execute on function public.pg_operaciones_contacto_propietario_m60(text,text,bigint,text,text,text,text) to anon,authenticated;
