let FONDO={rows:[],q:'',edificio:'',estado:''};
const FONDO_CONCEPTO='Fondo de reserva · cuota única';
async function vFondo(){
 const data=await rpc('pg_fondo_reserva',C);
 if(!data?.ok)throw new Error('No se pudo consultar el fondo con esta cuenta');
 if(V!=='fondo')return;
 FONDO.rows=data.residentes||[];
 $('vista').innerHTML=`<div class="card" style="border-color:var(--blue)"><h3>Fondo de reserva · cuota única de $1,000</h3><p class="sub">Registra la aportación una sola vez por unidad. El mantenimiento mensual de $515 se administra por separado. “Sin pago registrado” requiere revisar comprobantes antes de cobrar.</p><div class="grid g3"><div><label for="frQ">Buscar unidad o residente</label><input id="frQ" value="${esc(FONDO.q)}"></div><div><label for="frE">Edificio</label><select id="frE"><option value="">Todos</option>${[...new Set(FONDO.rows.map(r=>r.edificio))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('')}</select></div><div><label for="frS">Estado</label><select id="frS"><option value="">Todos</option><option value="pagado">Pagado registrado</option><option value="sin_registro">Sin pago registrado</option></select></div></div><button class="btn gh sm" id="frRef" style="margin-top:12px">↻ Actualizar fondo</button></div><div id="frRows"></div>`;
 $('frE').value=FONDO.edificio;$('frS').value=FONDO.estado;
 $('frQ').oninput=e=>{FONDO.q=e.target.value;pintarFondo();};
 $('frE').onchange=e=>{FONDO.edificio=e.target.value;pintarFondo();};
 $('frS').onchange=e=>{FONDO.estado=e.target.value;pintarFondo();};
 $('frRef').onclick=()=>render();pintarFondo();
}
function pintarFondo(){
 const rows=FONDO.rows.filter(r=>(!FONDO.edificio||r.edificio===FONDO.edificio)&&(!FONDO.estado||(FONDO.estado==='pagado'?r.pagado:!r.pagado))&&`${r.edificio} ${r.departamento} ${r.nombre_completo}`.toLowerCase().includes(FONDO.q.toLowerCase()));
 const pagados=rows.filter(r=>r.pagado);
 $('frRows').innerHTML=`<div class="kpis"><div class="kpi"><div class="l">Unidades filtradas</div><div class="v">${rows.length}</div></div><div class="kpi"><div class="l">Pagado registrado</div><div class="v">${pagados.length}</div></div><div class="kpi"><div class="l">Fondo registrado</div><div class="v">${money(pagados.reduce((s,r)=>s+Number(r.monto),0))}</div></div><div class="kpi"><div class="l">Sin pago registrado</div><div class="v">${rows.length-pagados.length}</div></div></div>`+rows.map(r=>`<div class="item"><div class="ihead"><b>${esc(r.edificio)} · ${esc(r.departamento)} · ${esc(r.nombre_completo)}</b><span class="pill ${r.pagado?'p-ok':'p-gray'}">${r.pagado?'Pagado registrado':'Sin pago registrado'}</span></div>${r.pagado?`<p class="sub">${money(r.monto)} · pago ${fecha(r.fecha_pago)} · ${esc(r.forma_pago)} · referencia ${esc(r.referencia)} · comprobante #${esc(r.folio)}</p><button class="btn gh sm" data-fr-recibo="${r.id_residente}">Ver comprobante del fondo</button>`:`<p class="sub">Cuota única de $1,000. Verifica primero si ya hay un comprobante.</p><button class="btn sm" data-fr-alta="${r.id_residente}">Registrar aportación</button>`}</div>`).join('')+(!rows.length?'<div class="empty">Sin unidades para estos filtros.</div>':'');
 $('frRows').querySelectorAll('[data-fr-alta]').forEach(b=>b.onclick=()=>formFondo(FONDO.rows.find(r=>r.id_residente===Number(b.dataset.frAlta))));
 $('frRows').querySelectorAll('[data-fr-recibo]').forEach(b=>b.onclick=()=>verFondo(FONDO.rows.find(r=>r.id_residente===Number(b.dataset.frRecibo))));
}
function verFondo(r){
 abrirRecibo(r.folio,esc(r.nombre_completo),esc(`${r.edificio}-${r.departamento}`),fecha(r.fecha_pago),[{c:FONDO_CONCEPTO,m:1000}],1000,r.forma_pago,null);
}
function formFondo(r,prev={}){
 if(!r||r.pagado)return;
 const hoy=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cancun',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 sheet(`<h3>Registrar fondo de reserva</h3><p>${esc(r.edificio)} · ${esc(r.departamento)} · ${esc(r.nombre_completo)}</p><p><b>Cuota única: $1,000</b></p><div><label for="frFecha">Fecha real del pago</label><input type="date" id="frFecha" required max="${hoy}" value="${esc(prev.fecha||hoy)}"></div><div style="margin-top:12px"><label for="frForma">Forma de pago</label><select id="frForma">${['Transferencia','Dep. en efectivo','Efectivo','Mercado Pago'].map(f=>`<option>${f}</option>`).join('')}</select></div><div style="margin-top:12px"><label for="frReferencia">Referencia o identificación del comprobante revisado</label><input id="frReferencia" maxlength="200" required value="${esc(prev.referencia||'')}" placeholder="Folio bancario o identificador del comprobante"></div><p class="sub">Revisa que el comprobante corresponda a esta unidad y al fondo de reserva de $1,000.</p><div class="acts"><button class="btn" id="frRevisar">Revisar antes de guardar</button><button class="btn gh" onclick="cerrarSheet()">Cancelar</button></div>`);
 $('frForma').value=prev.forma||'Transferencia';
 $('frRevisar').onclick=()=>{const fechaPago=$('frFecha'),referencia=$('frReferencia');if(!fechaPago.reportValidity()||!referencia.reportValidity()||!referencia.value.trim()){toast('Completa fecha y referencia.','err');return;}revisarFondo(r,{fecha:fechaPago.value,forma:$('frForma').value,referencia:referencia.value.trim()});};
}
function revisarFondo(r,pago){
 sheet(`<h3>Confirma el registro del fondo</h3><p><b>${esc(r.edificio)} · ${esc(r.departamento)}</b><br>${esc(r.nombre_completo)}</p><p>Fondo de reserva · cuota única<br><b>$1,000</b> · ${fecha(pago.fecha)} · ${esc(pago.forma)}</p><p>Referencia: ${esc(pago.referencia)}</p><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="frConfirmado" style="width:20px">Verifiqué el pago, la unidad y que esta aportación no esté registrada.</label><p class="sub">Al guardar se registra el fondo y se emite su comprobante. El mantenimiento no se modifica.</p><div id="frError" role="alert" style="color:var(--warn)"></div><div class="acts"><button class="btn ok" id="frGuardar" disabled>Confirmar registro de $1,000</button><button class="btn gh" id="frVolver">Volver</button></div>`);
 $('frConfirmado').onchange=e=>{$('frGuardar').disabled=!e.target.checked;};
 $('frVolver').onclick=()=>formFondo(r,pago);
 $('frGuardar').onclick=async()=>{
 if(!$('frConfirmado').checked)return;
 const boton=$('frGuardar');boton.disabled=true;$('frVolver').disabled=true;$('frConfirmado').disabled=true;
 try{const result=await rpc('pg_registrar_fondo_reserva',{...C,p_id_residente:r.id_residente,p_fecha_pago:pago.fecha,p_referencia:pago.referencia,p_forma_pago:pago.forma,p_confirmado:true});
 if(!result?.ok){$('frError').textContent=result?.error||'No se pudo registrar el fondo.';boton.disabled=false;$('frVolver').disabled=false;$('frConfirmado').disabled=false;return;}
 D.rc=null;
 const saved={...r,pagado:true,monto:1000,folio:result.folio,fecha_pago:pago.fecha,forma_pago:pago.forma,referencia:pago.referencia};
 FONDO.rows=FONDO.rows.map(x=>x.id_residente===saved.id_residente?saved:x);pintarFondo();
 sheet(`<h3>Fondo registrado</h3><p>${esc(r.edificio)} · ${esc(r.departamento)} · $1,000</p><p>Comprobante #${esc(result.folio)}. Puedes consultarlo también en Recibos emitidos.</p><div class="acts"><button class="btn" id="frVer">Ver / imprimir comprobante</button><button class="btn gh" id="frCerrar">Cerrar</button></div>`);
 $('frVer').onclick=()=>verFondo(saved);$('frCerrar').onclick=()=>{cerrarSheet();render();};toast('Fondo registrado con comprobante.','good');
 }catch(e){$('frError').textContent='No se pudo confirmar la respuesta. Actualiza el fondo antes de reintentar para comprobar si quedó registrado.';$('frVolver').disabled=false;}
 };
}
