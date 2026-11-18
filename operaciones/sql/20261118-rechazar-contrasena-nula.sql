-- Emergency fix for legacy RPCs whose PL/pgSQL IF comparisons could
-- evaluate to NULL and continue when p_password was JSON null.
-- Execute after any older migrations that recreate these functions.
-- Idempotent: an existing entry guard is left unchanged.
do $patch$
declare
  f record;
  source text;
  pos integer;
  guard text;
begin
  for f in
    select p.oid, p.proname, pg_get_function_result(p.oid) as resultado
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_identity_arguments(p.oid) ~ 'p_password (text|character varying)'
      and pg_get_function_result(p.oid) in ('json','jsonb')
  loop
    source := pg_get_functiondef(f.oid);
    if position('if p_password is null or btrim(p_password)' in source) > 0 then
      continue;
    end if;
    pos := strpos(source, E'\nbegin\n');
    if pos = 0 then
      raise exception 'Cannot guard %', f.proname;
    end if;
    guard := case when f.resultado = 'jsonb'
      then E'\nbegin\n  if p_password is null or btrim(p_password) = '''' then return jsonb_build_object(''ok'',false); end if;\n'
      else E'\nbegin\n  if p_password is null or btrim(p_password) = '''' then return json_build_object(''ok'',false); end if;\n'
    end;
    execute overlay(source placing guard from pos for length(E'\nbegin\n'));
  end loop;
end
$patch$;

-- Verification: patched = total; representative RPCs with a known username
-- and NULL password must return {"ok":false}.
select count(*) filter (
  where pg_get_functiondef(p.oid) like '%if p_password is null or btrim(p_password)%'
) as patched, count(*) as total
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and pg_get_function_identity_arguments(p.oid) ~ 'p_password (text|character varying)'
  and pg_get_function_result(p.oid) in ('json','jsonb');
