-- Evita ambigüedad entre variables PL/pgSQL y columnas del propietario.
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
