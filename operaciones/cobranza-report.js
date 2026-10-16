(function(root){
 function meses(rows){return Array.from({length:12},(_,i)=>rows.find(x=>Number(x.mes)===i+1)||{mes:i+1,estado_mes:'sin_cargos',estado:'sin_registro',cargos:0,facturado:0,cobrado:0,pendiente:0});}
 function totales(edificios){return meses([]).map(base=>{const rows=edificios.map(e=>meses(e.meses||[])[base.mes-1]);const sum=k=>rows.reduce((s,r)=>s+Number(r[k]||0),0);const facturado=sum('facturado'),cobrado=sum('cobrado');return {...base,cargos:sum('cargos'),facturado,cobrado,pendiente:sum('pendiente'),sin_registro:sum('sin_registro'),pct:facturado?100*cobrado/facturado:null,estado_mes:sum('cargos')?'normal':'sin_cargos'};});}
 function seguimiento(r,corte){
 const ms=meses(r.meses||[]).filter(m=>m.mes<=corte), actual=ms.find(m=>m.mes===corte), prev=ms.find(m=>m.mes===corte-1);
 const pendientes=ms.filter(m=>m.estado==='pendiente'), anteriores=pendientes.filter(m=>m.mes<corte);
 const fuera=ms.filter(m=>m.estado==='pagado'&&m.pagado_fuera_mes).length;
 const faltantes=ms.filter(m=>m.estado==='sin_registro'||m.estado==='revisar').length;
 const interrumpio=actual?.estado==='pendiente'&&prev?.estado==='pagado';
 let nivel='al_dia',accion='Sin pendientes registrados; mantener recordatorio habitual.',motivo='Sin pendientes registrados',orden=5;
 if(anteriores.length>=2){nivel='alta';orden=0;motivo=anteriores.length+' meses anteriores pendientes';accion='Revisar cuenta y comprobantes; acordar regularización y fecha de seguimiento.';}
 else if(anteriores.length){nivel='media';orden=1;motivo='Un mes anterior pendiente';accion='Validar el saldo y contactar para acordar fecha de pago.';}
 else if(interrumpio){nivel='preventiva';orden=2;motivo='Pagó el mes anterior; este sigue pendiente';accion='Enviar recordatorio cordial antes de acumular otro mes; confirmar si ya realizó el pago.';}
 else if(actual?.estado==='pendiente'){nivel='preventiva';orden=2;motivo='Cuota del mes pendiente';accion='Recordar la cuota vigente y confirmar la fecha estimada de pago.';}
 else if(fuera>=2){nivel='preventiva';orden=2;motivo=fuera+' cuotas pagadas después de su mes';accion='Proponer recordatorio previo a su fecha habitual de pago.';}
 else if(faltantes){nivel='revisar';orden=3;motivo=faltantes+' meses sin información completa';accion='Verificar cargos y comprobantes antes de cobrar o declarar al corriente.';}
 if(faltantes&&nivel!=='revisar')accion+=' Revisar también '+faltantes+' meses sin información completa.';
 return {...r,nivel,orden,motivo,accion,interrumpio,pendientes:pendientes.length,anteriores:anteriores.length,fuera,faltantes,saldo:pendientes.reduce((a,m)=>a+Number(m.saldo||0),0)};
 }
 root.EchoReport={meses,totales,seguimiento};
 if(typeof module!=='undefined')module.exports=root.EchoReport;
})(globalThis);
