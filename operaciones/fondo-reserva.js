const FONDO_CUOTA=1000;
let FONDO={rows:[],q:'',edificio:'',estado:''};
const FONDO_CONCEPTO='Fondo de reserva · cuota única';
async function vFondo(){
 const data=await rpc('pg_fondo_reserva',C);
 if(!data?.ok)throw new Error('No se pudo consultar el fondo con esta cuenta');
 if(V!=='fondo')return;
 FONDO.rows=data.residentes||[];
 $('vista').innerHTML=`<div class="card" style="border-color:var(--blue)"><h3>Fondo de reserva · cuota única de $1,000</h3><p class="sub">Registra la aportación una sola vez por unidad. El mantenimiento mensual de $515 se administra por separado. Marca como pagada la unidad cuando ya hayas confirmado su aportación.</p><div class="grid g3"><div><label for="frQ">Buscar unidad o residente</label><input id="frQ" value="${esc(FONDO.q)}"></div><div><label for="frE">Edificio</label><select id="frE"><option value="">Todos</option>${[...new Set(FONDO.rows.map(r=>r.edificio))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('')}</select></div><div><label for="frS">Estado</label><select id="frS"><option value="">Todos</option><option value="pagado">Pagado registrado</option><option value="sin_recibo">Pagado sin comprobante</option><option value="sin_registro">Sin pago registrado</option></select></div></div><div class="acts"><button class="btn" id="frRegistrar">Registrar pago del fondo</button><button class="btn gh sm" id="frRef">↻ Actualizar fondo</button><button class="btn gh sm" id="frVerRanking">Ver recaudación por edificio</button></div></div><div id="frRows"></div><div id="frRanking"></div>`;
 $('frE').value=FONDO.edificio;$('frS').value=FONDO.estado;
 $('frQ').oninput=e=>{FONDO.q=e.target.value;pintarFondo();};
 $('frE').onchange=e=>{FONDO.edificio=e.target.value;pintarFondo();};
 $('frS').onchange=e=>{FONDO.estado=e.target.value;pintarFondo();};
 $('frRegistrar').onclick=()=>{
  FONDO.estado='sin_registro';
  $('frS').value=FONDO.estado;
  pintarFondo();
  $('frQ').focus();
 };
 $('frVerRanking').onclick=()=>$('frRanking').scrollIntoView({block:'start'});
 $('frRef').onclick=()=>render();pintarRankingFondo();pintarFondo();
}
function rankingFondo(rows){
 const edificios=new Map();
 for(const unidad of rows){
  const clave=JSON.stringify([unidad.condominio_id,unidad.edificio]);
  if(!edificios.has(clave)){
   edificios.set(clave,{edificio:unidad.edificio,condominio:unidad.condominio,unidades:0,pagadas:0});
  }
  const edificio=edificios.get(clave);
  edificio.unidades++;
  if(unidad.pagado)edificio.pagadas++;
 }
 return [...edificios.values()].sort((a,b)=>
  b.pagadas*a.unidades-a.pagadas*b.unidades ||
  a.edificio.localeCompare(b.edificio,'es',{numeric:true}) ||
  (a.condominio||'').localeCompare(b.condominio||'','es'));
}
function pintarRankingFondo(){
 const edificios=rankingFondo(FONDO.rows);
 const porcentaje=new Intl.NumberFormat('es-MX',{style:'percent',maximumFractionDigits:2});
 $('frRanking').innerHTML=`<div class="card">
  <h3>Recaudación del fondo por edificio</h3>
  <p class="sub">Ordenado por porcentaje recaudado. La meta es de ${money(FONDO_CUOTA)} por unidad. El comparativo abarca todos tus edificios y se mantiene visible al filtrar unidades.</p>
  ${edificios.length?edificios.map(e=>`<div class="item">
   <div class="ihead"><b>${esc(e.edificio)}${e.condominio?' · '+esc(e.condominio):''}</b>
    <span class="pill p-ok">${porcentaje.format(e.pagadas/e.unidades)}</span></div>
   <p class="sub">${money(e.pagadas*FONDO_CUOTA)} de ${money(e.unidades*FONDO_CUOTA)} MXN · ${e.pagadas} de ${e.unidades} unidades pagadas</p>
  </div>`).join(''):'<div class="empty">Sin edificios disponibles para el fondo.</div>'}
 </div>`;
}
function pintarFondo(){
 const rows=FONDO.rows.filter(r=>(!FONDO.edificio||r.edificio===FONDO.edificio)&&(!FONDO.estado||(FONDO.estado==='pagado'?r.pagado:FONDO.estado==='sin_recibo'?r.pagado&&!r.folio:!r.pagado))&&`${r.edificio} ${r.departamento} ${r.nombre_completo}`.toLowerCase().includes(FONDO.q.toLowerCase()));
 const pagados=rows.filter(r=>r.pagado);
 $('frRows').innerHTML=`<div class="kpis"><div class="kpi"><div class="l">Unidades filtradas</div><div class="v">${rows.length}</div></div><div class="kpi"><div class="l">Pagado registrado</div><div class="v">${pagados.length}</div></div><div class="kpi"><div class="l">Fondo registrado</div><div class="v">${money(pagados.reduce((s,r)=>s+Number(r.monto),0))}</div></div><div class="kpi"><div class="l">Sin pago registrado</div><div class="v">${rows.length-pagados.length}</div></div></div>`+rows.slice(0,20).map(r=>`<div class="item"><div class="ihead"><b>${esc(r.edificio)} · ${esc(r.departamento)} · ${esc(r.nombre_completo)}</b><span class="pill ${r.pagado?'p-ok':'p-gray'}">${r.pagado?'Pagado registrado':'Sin pago registrado'}</span></div>${r.pagado?(r.folio?`<p class="sub">${money(r.monto)} · pago ${fecha(r.fecha_pago)} · ${esc(r.forma_pago)}${r.referencia?' · referencia '+esc(r.referencia):''} · comprobante #${esc(r.folio)}</p><button class="btn gh sm" data-fr-recibo="${r.id_residente}">Ver comprobante del fondo</button>`:`<p class="sub">${money(r.monto)}${r.registrado_at?' · Registrado el '+fecha(r.registrado_at):''}</p><button class="btn gh sm" data-fr-emitir="${r.id_residente}">Emitir comprobante del fondo</button>`):`<button class="btn sm" data-fr-alta="${r.id_residente}">Registrar pago</button>`}</div>`).join('')+(rows.length>20?'<p class="sub">Mostrando 20 unidades. Usa el buscador o filtra por edificio para encontrar tu unidad.</p>':'')+(!rows.length?'<div class="empty">Sin unidades para estos filtros.</div>':'');
 $('frRows').querySelectorAll('[data-fr-alta]').forEach(b=>b.onclick=()=>revisarFondo(FONDO.rows.find(r=>r.id_residente===Number(b.dataset.frAlta))));
 $('frRows').querySelectorAll('[data-fr-emitir]').forEach(b=>b.onclick=()=>emitirReciboFondo(FONDO.rows.find(r=>r.id_residente===Number(b.dataset.frEmitir))));
 $('frRows').querySelectorAll('[data-fr-recibo]').forEach(b=>b.onclick=()=>verFondo(FONDO.rows.find(r=>r.id_residente===Number(b.dataset.frRecibo))));
}
function verFondo(r){
 abrirRecibo(r.folio,esc(r.nombre_completo),esc(`${r.edificio}-${r.departamento}`),fecha(r.fecha_pago),[{c:FONDO_CONCEPTO,m:1000}],1000,r.forma_pago,null);
}
function revisarFondo(r){
 if(!r||r.pagado)return;
 sheet(`<h3>Confirmar pago del fondo</h3>
  <p><b>${esc(r.edificio)} · ${esc(r.departamento)}</b><br>${esc(r.nombre_completo)}</p>
  <p>Fondo de reserva · cuota única de <b>${money(FONDO_CUOTA)} MXN</b></p>
  <p class="sub">Confirma que esta unidad ya pagó la aportación.</p>
  <div id="frError" role="alert" style="color:var(--warn)"></div>
  <div class="acts"><button class="btn ok" id="frGuardar">Confirmar pago</button>
   <button class="btn gh" id="frCancelar">Cancelar</button></div>`);
 const boton=$('frGuardar'), cancelar=$('frCancelar'), error=$('frError');
 cancelar.onclick=cerrarSheet;
 boton.onclick=async()=>{
  if(boton.disabled)return;
  boton.disabled=true;
  cancelar.disabled=true;
  error.textContent='';
  try{
   const result=await rpc('pg_marcar_fondo_reserva_pagado',{...C,p_id_residente:r.id_residente,p_confirmado:true});
   if(!result?.ok)throw new Error(result?.error||'No se pudo registrar el fondo.');
   const dialogoAbierto=$('frGuardar')===boton;
   if(dialogoAbierto)cerrarSheet();
   if(V==='fondo'){
    if(result.ya_registrado){
     render();
    }else{
     FONDO.rows=FONDO.rows.map(unidad=>unidad.id_residente===r.id_residente
      ?{...unidad,pagado:true,monto:FONDO_CUOTA,registrado_at:result.registrado_at}:unidad);
     pintarRankingFondo();
     pintarFondo();
     if(dialogoAbierto){
      sheet(`<h3>Pago del fondo registrado</h3><p>${esc(r.edificio)} · ${esc(r.departamento)}</p>
       <div class="acts"><button class="btn" id="frEmitirAhora">Emitir comprobante del fondo</button>
       <button class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>`);
      $('frEmitirAhora').onclick=()=>emitirReciboFondo(r);
     }
    }
   }
   toast(result.ya_registrado?'El fondo de esta unidad ya estaba registrado.':'Pago del fondo registrado.','good');
  }catch(e){
   error.textContent=e.message.startsWith('HTTP ')
    ?'No se pudo confirmar el registro. Puedes volver a intentarlo.'
    :e.message;
   boton.disabled=false;
   cancelar.disabled=false;
  }
 };
}

function emitirReciboFondo(r){
 const hoy=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Cancun'}).format(new Date());
 sheet(`<h3>Emitir comprobante del fondo</h3>
  <p><b>${esc(r.edificio)} · ${esc(r.departamento)}</b> · ${esc(r.nombre_completo)} · ${money(FONDO_CUOTA)} MXN</p>
  <div class="grid g2">
   <div><label for="frFecha">Fecha del pago</label><input id="frFecha" type="date" max="${hoy}" value="${esc(r.fecha_pago||'')}" required></div>
   <div><label for="frForma">Forma de pago</label><select id="frForma" required><option value="">Selecciona</option><option>Transferencia</option><option>Dep. en efectivo</option><option>Efectivo</option><option>Mercado Pago</option></select></div>
  </div>
  <p class="sub">El comprobante quedará vinculado al pago ya registrado.</p>
  <div id="frEmError" role="alert" style="color:var(--warn)"></div>
  <div class="acts"><button class="btn" id="frEmitir">Emitir comprobante</button><button class="btn gh" id="frEmCancelar">Cancelar</button></div>`);
 const fechaPago=$('frFecha'),forma=$('frForma'),boton=$('frEmitir'),cancelar=$('frEmCancelar'),error=$('frEmError');
 if(r.forma_pago)forma.value=r.forma_pago;
 cancelar.onclick=cerrarSheet;
 boton.onclick=async()=>{
  if(boton.disabled||!fechaPago.reportValidity()||!forma.reportValidity())return;
  boton.disabled=true;
  cancelar.disabled=true;
  error.textContent='';
  try{
   const result=await rpc('pg_emitir_recibo_fondo_reserva',{...C,p_id_residente:r.id_residente,p_fecha_pago:fechaPago.value,p_forma_pago:forma.value});
   if(!result?.ok)throw new Error(result?.error||'No se pudo emitir el comprobante.');
   const pago={folio:result.folio,fecha_pago:result.fecha_pago,forma_pago:result.forma_pago};
   D.rc=null;
   if(V==='fondo'){
    FONDO.rows=FONDO.rows.map(u=>u.id_residente===r.id_residente?{...u,...pago}:u);
    pintarFondo();
   }
   if($('frEmitir')===boton){
    sheet(`<h3>Comprobante #${esc(result.folio)} emitido</h3>
     <div class="acts"><button class="btn" id="frVerEmitido">Ver o imprimir comprobante</button>
     <button class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>`);
    $('frVerEmitido').onclick=()=>verFondo({...r,...pago});
   }
  }catch(e){
   error.textContent=e.message.startsWith('HTTP ')?'No se pudo confirmar la emisión. Puedes volver a intentarlo.':e.message;
   boton.disabled=false;
   cancelar.disabled=false;
  }
 };
}
