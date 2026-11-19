-- An anonymous caller may no longer map a unit code to a synthetic Auth email.
-- The resident password is checked against the existing portal credential first.
create or replace function public.resolver_identidad(p_clave text, p_password text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare v_email text;
begin
  if p_clave is null or p_password is null or btrim(p_password) = ''
     or length(p_clave) > 100 or length(p_password) > 128 then
    return null;
  end if;
  select pf.email_sintetico into v_email
  from public.residentes r
  join public.perfiles pf on pf.id_residente_legacy = r.id_residente
  where r.user_id = p_clave
    and r.password_hash is not null
    and extensions.crypt(p_password, r.password_hash) = r.password_hash
    and lower(regexp_replace(coalesce(pf.clave_legacy,''),'[^A-Za-z0-9]','','g'))
        = lower(regexp_replace(p_clave,'[^A-Za-z0-9]','','g'))
  order by pf.id_residente_legacy nulls last
  limit 1;
  return v_email;
end
$fn$;

revoke all on function public.resolver_identidad(text) from public, anon, authenticated;
grant execute on function public.resolver_identidad(text,text) to anon, authenticated;
