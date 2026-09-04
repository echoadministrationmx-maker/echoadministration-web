// Echo Administración — configuración central de regularización
// Calcula propuestas; la activación del convenio sigue requiriendo aceptación y primer pago.
window.ECHO_PLANES={
 cuotaOrdinaria:515,
 descuentosPorAntiguedad:[{mesesMinimos:13,porcentaje:20},{mesesMinimos:7,porcentaje:10},{mesesMinimos:0,porcentaje:0}],
 planes:[{id:'rapido',nombre:'Echo Rápido',meses:3,recomendado:false},{id:'regulariza',nombre:'Echo Regulariza',meses:6,recomendado:true},{id:'flexible',nombre:'Echo Flexible',meses:12,recomendado:false}],
 obtenerDescuento(mesesVencidos){const m=Math.max(0,Number(mesesVencidos)||0),r=this.descuentosPorAntiguedad.find(x=>m>=x.mesesMinimos);return r?r.porcentaje:0},
 calcular(adeudoHistorico,mesesVencidos=0,cuota=515){const original=Math.max(0,Number(adeudoHistorico)||0),actual=Math.max(0,Number(cuota)||this.cuotaOrdinaria),pct=this.obtenerDescuento(mesesVencidos),desc=Math.round(original*pct)/100,saldo=Math.max(0,Math.round((original-desc)*100)/100);return this.planes.map(plan=>{const abono=Math.ceil(saldo/plan.meses*100)/100,total=Math.ceil((abono+actual)*100)/100;return{...plan,mesesVencidos:Math.max(0,Number(mesesVencidos)||0),adeudoOriginal:original,descuentoPct:pct,descuentoMonto:desc,adeudoConDescuento:saldo,cuotaCorriente:actual,abonoDeuda:abono,totalMensual:total,totalQuincenal:Math.ceil(total/2*100)/100}})},
 social(adeudoHistorico,mesesVencidos,abonoDeuda,cuota=515){const p=this.calcular(adeudoHistorico,mesesVencidos,cuota)[0],abono=Math.max(0,Number(abonoDeuda)||0),actual=Math.max(0,Number(cuota)||this.cuotaOrdinaria);return{id:'social',nombre:'Echo Social',mesesVencidos:p.mesesVencidos,adeudoOriginal:p.adeudoOriginal,descuentoPct:p.descuentoPct,descuentoMonto:p.descuentoMonto,adeudoConDescuento:p.adeudoConDescuento,cuotaCorriente:actual,abonoDeuda:abono,totalMensual:actual+abono,totalQuincenal:Math.ceil((actual+abono)/2*100)/100,requiereAprobacion:true}}
};
window.addEventListener('load',()=>{
 if(typeof sendOffer!=='function'||typeof rpc!=='function')return;
 const abrir=sendOffer;
 sendOffer=async function(id,term){
  try{
   const r=residentes.find(x=>Number(x.id_residente)===Number(id));
   if(r){const p=calc(r).find(x=>x.meses===Number(term));if(p)await rpc('pg_registrar_oferta_regularizacion',{...C,p_id_residente:r.id_residente,p_plan:p.nombre,p_plazo_meses:p.meses,p_meses_vencidos:meses(r),p_saldo_historico:hist(r),p_descuento_pct:p.descuentoPct,p_saldo_regularizado:p.adeudoConDescuento,p_cuota_corriente:p.cuotaCorriente,p_abono_deuda:p.abonoDeuda,p_total_mensual:p.totalMensual,p_total_quincenal:p.totalQuincenal,p_estado:'ofrecida',p_notas:'Oferta preparada desde módulo de regularización'});}
  }catch(e){console.warn('No se pudo registrar bitácora de oferta',e)}
  return abrir(id,term);
 };
});
