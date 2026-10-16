-- Read-only report. Uses the portal's existing admin password verification.
create or replace function public.pg_reporte_cobranza(p_user text,p_password text,p_anio integer,p_mes integer)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare h text; periodo_actual date;
begin
 select password_hash into h from public.admins where user_id=p_user limit 1;
 if h is null or p_password is null or extensions.crypt(p_password,h) is distinct from h then return jsonb_build_object('ok',false); end if;
 periodo_actual:=make_date(p_anio,p_mes,1);
 return (with detalle as (
 select r.id_residente,trim(r.num) edificio,r.departamento,r.nombre_completo,
 p.periodo,p.estado,p.monto,p.fecha_pago
 from public.residentes r left join public.pagos p on p.id_residente=r.id_residente
 and p.periodo>=least(make_date(p_anio,1,1),(periodo_actual-interval '1 month')::date)
 and p.periodo<make_date(p_anio+1,1,1)
 and p.concepto ~* '^Cuota '
 ), comparativa as (
 select id_residente,edificio,departamento,nombre_completo,
 count(*) filter(where periodo=(periodo_actual-interval '1 month')::date and estado='pagado')>0 pago_anterior,
 count(*) filter(where periodo=periodo_actual)>0 tiene_cargo,
 count(*) filter(where periodo=periodo_actual and estado='pendiente')>0 pendiente,
 coalesce(sum(monto) filter(where periodo=periodo_actual and estado='pendiente'),0) saldo
 from detalle group by 1,2,3,4
 ), edificios as (
 select edificio,count(distinct id_residente) unidades,
 (select jsonb_agg(jsonb_build_object('mes',m,'cargos',n,'facturado',facturado,'cobrado',cobrado,'pendiente',pendiente,
 'sin_registro',greatest(0,unidades-n),'pct',case when facturado>0 then round(100*cobrado/facturado,1) else null end,
 'estado_mes',case when n=0 then 'sin_cargos' else 'normal' end) order by m)
 from (select m,count(x.periodo)::int n,count(distinct d.id_residente)::int unidades,
 coalesce(sum(x.monto),0)::numeric facturado,coalesce(sum(x.monto) filter(where x.estado='pagado'),0)::numeric cobrado,
 coalesce(sum(x.monto) filter(where x.estado='pendiente'),0)::numeric pendiente
 from generate_series(1,12) m cross join (select distinct id_residente from detalle where edificio=d0.edificio)d
 left join detalle x on x.id_residente=d.id_residente and x.periodo=make_date(p_anio,m,1)
 group by m)t) meses from detalle d0 where coalesce(edificio,'')<>'' group by edificio
 ) select jsonb_build_object('ok',true,'anio',p_anio,'mes',p_mes,
  'seguimiento',coalesce((select jsonb_agg(jsonb_build_object(
 'id_residente',r.id_residente,'edificio',trim(r.num),'departamento',r.departamento,'nombre_completo',r.nombre_completo,
 'meses',(select jsonb_agg(to_jsonb(z) order by z.mes) from (
 select m as mes,
 case when make_date(p_anio,m,1)>periodo_actual then 'futuro'
 when count(x.periodo)=0 then 'sin_registro'
 when count(*) filter(where x.estado='pendiente')>0 then 'pendiente'
 when count(*) filter(where x.estado='pagado')=count(x.periodo) then 'pagado' else 'revisar' end as estado,
 coalesce(sum(x.monto) filter(where x.estado='pendiente'),0) as saldo,
 coalesce(bool_or(x.estado='pagado' and x.fecha_pago::date>=(x.periodo+interval '1 month')::date),false) as pagado_fuera_mes
 from generate_series(1,12) m left join detalle x on x.id_residente=r.id_residente and x.periodo=make_date(p_anio,m,1)
 group by m) z)

 ) order by trim(r.num),r.departamento) from public.residentes r where coalesce(trim(r.num),'')<>''),'[]'::jsonb),
 'comparativa',coalesce((select jsonb_agg(to_jsonb(c) order by edificio,departamento) from comparativa c where pago_anterior and (pendiente or not tiene_cargo)),'[]'::jsonb),
 'edificios',coalesce((select jsonb_agg(to_jsonb(e) order by edificio) from edificios e),'[]'::jsonb)));
end; $$;
revoke all on function public.pg_reporte_cobranza(text,text,integer,integer) from public;
grant execute on function public.pg_reporte_cobranza(text,text,integer,integer) to anon,authenticated;
