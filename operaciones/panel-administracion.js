'use strict';

const rutaPanel = location.pathname.replace(/\/$/,'');
const manzanaDeRuta = {
  '/operaciones/manzana-60':'M60',
  '/operaciones/manzana-80':'M80'
}[rutaPanel];
const rutaGeneral = rutaPanel==='/operaciones/general';
const VISTAS_M60 = [
  {g:'Administración'},
  {k:'resumen-local',t:'Resumen',i:'📊'},
  {k:'cobranza-m60',t:'Cobranza y seguimiento',i:'📈'},
  {k:'fondo-cadu-m60',t:'Fondo pagado a CADU',i:'🛟'},
  {k:'datos-pago-m60',t:'Datos para pagar',i:'🏦'},
  {k:'descuentos-m60',t:'Descuentos opcionales',i:'🏷️'},
  {k:'incidencias-locales',t:'Incidencias',i:'🔧'},
  {k:'gastos-locales',t:'Gastos',i:'🧾'}
];
const ESTADOS_INCIDENCIA = {pendiente:'Pendiente',en_proceso:'En proceso',resuelta:'Resuelta'};
const filtroM60={anio:2026,mes:Number(new Date().toLocaleDateString('en-US',{timeZone:'America/Cancun',month:'numeric'})),edificio:'',busqueda:''};

function nombrePanel() {
  if (manzanaDeRuta==='M60') return 'Operaciones · Manzanas 60 y 61';
  if (manzanaDeRuta) return 'Operaciones · Manzana '+manzanaDeRuta.slice(1);
  return rutaGeneral ? 'Operaciones generales · Echo' : 'Panel de Operaciones';
}

function inicioPanel() {
  if (rutaGeneral && !new URLSearchParams(location.search).has('condominio')) return 'portafolio';
  if (condominioActivo.codigo==='M80') return 'inicio';
  return condominioActivo.codigo==='M60' ? 'resumen-local' : 'propietarios';
}

function prepararAccesoPanel() {
  document.title = nombrePanel();
  $('loginTitulo').textContent = nombrePanel();
  $('marcaFondo').classList.toggle('hide',rutaGeneral || manzanaDeRuta==='M60');
  $('loginRutas').classList.toggle('hide',Boolean(manzanaDeRuta));
}

function verAccesoPanel(d) {
  if (rutaGeneral && !d.puede_crear) return 'La vista general requiere acceso de plataforma de Echo.';
  if (manzanaDeRuta && !d.condominios.some(c=>c.codigo===manzanaDeRuta)) return 'Tu usuario no tiene acceso a esta manzana.';
  return '';
}

function kpiPanel(etiqueta,valor) {
  return `<div class="kpi"><div class="l">${esc(etiqueta)}</div><div class="v">${esc(valor)}</div></div>`;
}

async function vPortafolio() {
  const d = await rpc('pg_operaciones_portafolio',C);
  if (!d.ok) throw new Error(d.error);
  if (V!=='portafolio') return;
  const total = campo=>d.condominios.reduce((n,c)=>n+Number(c[campo]),0);
  $('vista').innerHTML = `
    <div class="card"><h2>Condominios de Echo</h2><p class="sub">Abre una manzana para consultar su padrón y sus operaciones.</p></div>
    <div class="kpis">
      ${kpiPanel('Condominios',d.condominios.length)}
      ${kpiPanel('Unidades activas',total('unidades'))}
      ${kpiPanel('Fichas de propietario',total('propietarios'))}
      ${kpiPanel('Solicitudes pendientes',total('solicitudes'))}
    </div>
    ${d.condominios.map(c=>`<div class="card">
      <div class="chead"><h3>${esc(c.nombre)}</h3><button type="button" class="btn sm" data-abrir-cond="${c.id}">Abrir panel</button></div>
      <p class="sub">${esc(c.unidades)} unidades · ${esc(c.propietarios)} propietarios · ${esc(c.solicitudes)} solicitudes pendientes · ${esc(c.cargas)} importaciones</p>
    </div>`).join('')}`;
  $('vista').querySelectorAll('[data-abrir-cond]').forEach(b=>{
    b.onclick=()=>{
      const condominio = condominios.find(c=>c.id===Number(b.dataset.abrirCond));
      if (!condominio) return;
      $('condSelector').value = String(condominio.id);
      cambiarCondominio(condominio.id,condominio.codigo==='M80'?'inicio':condominio.codigo==='M60'?'resumen-local':'propietarios');
    };
  });
}

async function operacionesLocales(condominio,tipo,cambio) {
  const d = await rpc('pg_operaciones_locales',{...C,p_condominio:condominio.id,p_tipo:tipo,...(cambio?{p_cambio:cambio}:{})});
  if (!d.ok) throw new Error(d.error);
  return d;
}

async function vResumenLocal() {
  const condominio = condominioActivo;
  const [padron,local,panel] = await Promise.all([datosPadron(condominio.id),operacionesLocales(condominio,'incidencia'),
    rpc('pg_operaciones_panel_m60',{...C,p_condominio:condominio.id,p_anio:filtroM60.anio})]);
  if(!panel.ok)throw new Error(panel.error);
  if (V!=='resumen-local' || condominio!==condominioActivo) return;
  const unidades=panel.unidades||[];
  const pagados=unidades.filter(u=>u.pagos?.[filtroM60.mes]).length;
  const fondos=unidades.filter(u=>u.fondo_cadu).length;
  $('vista').innerHTML = `
    <div class="card"><h2>${esc(condominio.nombre)}</h2><p class="sub">Panel de administración del condominio.</p></div>
    <div class="kpis">
      ${kpiPanel('Unidades activas',padron.unidades)}
      ${kpiPanel('Propietarios',agruparPropietarios(padron.padron).length)}
      ${kpiPanel('Solicitudes por revisar',padron.solicitudes.length)}
      ${kpiPanel('Mensualidades marcadas · '+MES[filtroM60.mes],pagados+' / '+unidades.length)}
      ${kpiPanel('Fondo CADU · $1,500',fondos+' / '+unidades.length)}
      ${kpiPanel('Incidencias abiertas',local.resumen.incidencias)}
      ${kpiPanel('Gastos del mes',money(local.resumen.gastos_mes))}
    </div>
    <div class="card"><h3>Padrón y operación diaria</h3><div class="acts">
      <button class="btn" data-local-nav="archivos">Subir padrón de propietarios</button>
      <button class="btn gh" data-local-nav="propietarios">Revisar solicitudes</button>
      <button class="btn gh" data-local-nav="cobranza-m60">Cobranza y seguimiento</button>
      <button class="btn gh" data-local-nav="fondo-cadu-m60">Fondo pagado a CADU</button>
      <button class="btn gh" data-local-nav="datos-pago-m60">Datos para pagar y contacto</button>
      <button class="btn gh" data-local-nav="pago-m60">Registrar mensualidad</button>
      <button class="btn gh" data-local-nav="descuentos-m60">Configurar descuentos</button>
      <button class="btn gh" data-local-nav="incidencias-locales">Ver incidencias</button>
      <button class="btn gh" data-local-nav="gastos-locales">Ver gastos</button>
    </div></div>`;
  $('vista').querySelectorAll('[data-local-nav]').forEach(b=>b.onclick=()=>ir(b.dataset.localNav));
}

async function vDatosPagoM60() {
  const condominio=condominioActivo;
  const r=await rpc('pg_operaciones_pago_info_m60',{...C,p_condominio:condominio.id});
  if(!r.ok)throw new Error(r.error);
  if(condominio!==condominioActivo||V!=='datos-pago-m60')return;
  const d=r.datos;
  $('vista').innerHTML=`<div class="card"><h2>Información de pago · Manzanas 60 y 61</h2>
    <p class="sub">Esta información aparece también en el registro público de propietarios. La terminal Clip está anunciada como próxima, no como método activo.</p>
    <div class="kpis" style="margin-top:16px">
      ${kpiPanel('Cuota de mantenimiento',money(d.cuota_mensual))}
      ${kpiPanel('Banco',d.banco)}
      ${kpiPanel('CLABE para transferencias',d.clabe)}
      ${kpiPanel('Cuenta para depósito',d.cuenta_deposito)}
    </div>
    <p class="sub">Concepto sugerido: número de cliente + manzana + edificio + departamento + mes(es) + año + nombre. El número de cliente es el mismo de la administración anterior.</p>
  </div><div class="card"><h3>Contacto de administración</h3>
    <p class="sub">Puedes actualizar el número y los correos publicados. La CLABE y la cuenta no se cambian desde este formulario.</p>
    <form id="editarContactoM60" class="grid g2" style="margin-top:14px">
      <div><label for="adminTelefonoM60">Teléfono / WhatsApp</label><input id="adminTelefonoM60" type="tel" maxlength="25" value="${esc(d.telefono_contacto)}" required></div>
      <div><label for="adminCorreoM60">Correo de consultas</label><input id="adminCorreoM60" type="email" maxlength="254" value="${esc(d.correo_contacto)}" required></div>
      <div><label for="adminComprobantesM60">Correo para comprobantes</label><input id="adminComprobantesM60" type="email" maxlength="254" value="${esc(d.correo_comprobantes)}" required></div>
      <div class="acts"><button class="btn">Guardar contacto</button></div>
    </form><p class="sub" id="estadoContactoM60" role="status"></p></div>`;
  $('editarContactoM60').onsubmit=async e=>{
    e.preventDefault();const boton=e.currentTarget.querySelector('button');boton.disabled=true;
    $('estadoContactoM60').textContent='';
    try{
      const result=await rpc('pg_operaciones_pago_info_m60',{...C,p_condominio:condominio.id,p_cambio:{
        telefono_contacto:$('adminTelefonoM60').value.trim(),correo_contacto:$('adminCorreoM60').value.trim(),
        correo_comprobantes:$('adminComprobantesM60').value.trim()
      }});
      if(!result.ok)throw new Error(result.error);
      toast('Contacto actualizado','good');await vDatosPagoM60();
    }catch(error){$('estadoContactoM60').textContent=error.message;boton.disabled=false;}
  };
}

async function vCobranzaM60() {
  const condominio=condominioActivo;
  const d=await rpc('pg_operaciones_panel_m60',{...C,p_condominio:condominio.id,p_anio:filtroM60.anio});
  if(!d.ok)throw new Error(d.error);
  if(condominio!==condominioActivo||V!=='cobranza-m60')return;
  const units=d.unidades||[];
  const buildingNames=[...new Set(units.map(u=>u.edificio))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  const mes=String(filtroM60.mes);
  const pagados=units.filter(u=>u.pagos?.[mes]);
  const destino=(name)=>pagados.filter(u=>u.pagos[mes].destino===name).length;
  const previo=filtroM60.mes>1?units.filter(u=>u.pagos?.[String(filtroM60.mes-1)]).length:0;
  const visibles=units.filter(u=>(!filtroM60.edificio||u.edificio===filtroM60.edificio)
    &&(!filtroM60.busqueda||`${u.edificio}-${u.numero} ${u.nombre||''} ${u.clave_cadu||''}`.toLowerCase().includes(filtroM60.busqueda.toLowerCase())));
  $('vista').innerHTML=`<div class="card"><h2>Cobranza y seguimiento · Manzanas 60 y 61</h2>
    <p class="sub">Cuotas de $500 marcadas como pagadas. Una celda sin registro requiere verificación; no se presume adeudo. El fondo CADU se muestra aparte.</p>
    <form id="filtroCobM60" class="grid g3" style="margin-top:14px">
      <div><label for="cobM60Anio">Año</label><select id="cobM60Anio">${[2026,2025,2024,2023,2022,2027].map(y=>`<option ${filtroM60.anio===y?'selected':''}>${y}</option>`).join('')}</select></div>
      <div><label for="cobM60Mes">Mes</label><select id="cobM60Mes">${MES.slice(1).map((m,i)=>`<option value="${i+1}" ${filtroM60.mes===i+1?'selected':''}>${m}</option>`).join('')}</select></div>
      <div><label for="cobM60Edificio">Edificio</label><select id="cobM60Edificio"><option value="">Todos</option>${buildingNames.map(b=>`<option value="${esc(b)}" ${filtroM60.edificio===b?'selected':''}>${esc(b)}</option>`).join('')}</select></div>
      <div><label for="cobM60Buscar">Buscar unidad, titular o clave CADU</label><input id="cobM60Buscar" value="${esc(filtroM60.busqueda)}"></div>
      <div class="acts"><button class="btn sm">Aplicar filtros</button></div>
    </form></div>
    <div class="kpis">${kpiPanel('Pagos marcados · '+MES[filtroM60.mes],pagados.length+' / '+units.length)}
      ${kpiPanel('Recaudación del periodo',money(pagados.length*500))}
      ${kpiPanel('Registrados con CADU',destino('CADU'))}
      ${kpiPanel('Nueva administración',destino('Nueva administración'))}
      ${kpiPanel('Pagos marcados mes previo',filtroM60.mes===1?'Consulta diciembre del año anterior':previo)}
      ${kpiPanel('Fondo CADU',units.filter(u=>u.fondo_cadu).length+' / '+units.length)}</div>
    <div class="card"><h3>Recaudación por edificio · ${esc(MES[filtroM60.mes])} ${filtroM60.anio}</h3>
      ${tablaCond(['Edificio','Pagaron','Unidades','Porcentaje','Fondo CADU'],buildingNames.map(b=>{
        const g=units.filter(u=>u.edificio===b),n=g.filter(u=>u.pagos?.[mes]).length;
        return [b,n,g.length,Math.round(n/g.length*100)+'%',g.filter(u=>u.fondo_cadu).length+' / '+g.length];
      }))}</div>
    <div class="card"><h3>Seguimiento anual por unidad</h3><p class="sub">✓ pago marcado · — sin registro. Filtra por edificio o titular para revisar un grupo.</p>
      <div class="cond-tabla"><table><thead><tr><th>Unidad</th><th>Titular / clave CADU</th>
      ${MES.slice(1).map(m=>`<th>${esc(m.slice(0,3))}</th>`).join('')}</tr></thead><tbody>
      ${visibles.map(u=>`<tr><td>${esc(u.edificio)}-${esc(u.numero)}</td><td>${esc(u.nombre||'—')}<br><small>${esc(u.clave_cadu||'')}</small></td>
        ${Array.from({length:12},(_,i)=>`<td title="${u.pagos?.[i+1]?esc(u.pagos[i+1].destino):'Sin registro'}">${u.pagos?.[i+1]?'✓':'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${visibles.length?'':'<p class="sub">Sin unidades para estos filtros.</p>'}</div>`;
  $('filtroCobM60').onsubmit=e=>{e.preventDefault();filtroM60.anio=Number($('cobM60Anio').value);
    filtroM60.mes=Number($('cobM60Mes').value);filtroM60.edificio=$('cobM60Edificio').value;
    filtroM60.busqueda=$('cobM60Buscar').value.trim();vCobranzaM60().catch(error=>toast(error.message));};
}

async function vFondoCaduM60() {
  const condominio=condominioActivo;
  const d=await rpc('pg_operaciones_panel_m60',{...C,p_condominio:condominio.id,p_anio:2026});
  if(!d.ok)throw new Error(d.error);
  if(condominio!==condominioActivo||V!=='fondo-cadu-m60')return;
  const units=d.unidades||[],pagados=units.filter(u=>u.fondo_cadu),edificios=[...new Set(units.map(u=>u.edificio))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
  $('vista').innerHTML=`<div class="card"><h2>Fondo pagado a CADU</h2>
    <p class="sub">Fondo de $1,500 registrado en el archivo recibido. Se mantiene separado de los fondos y recibos de Echo. Sin registro no confirma adeudo.</p></div>
    <div class="kpis">${kpiPanel('Pagaron a CADU',pagados.length+' / '+units.length)}
    ${kpiPanel('Monto reportado',money(pagados.length*1500))}
    ${kpiPanel('Sin registro en el archivo',units.length-pagados.length)}</div>
    <div class="card"><h3>Por edificio</h3>${tablaCond(['Edificio','Pagaron CADU','Unidades','Porcentaje'],edificios.map(b=>{
      const g=units.filter(u=>u.edificio===b),n=g.filter(u=>u.fondo_cadu).length;
      return [b,n,g.length,Math.round(n/g.length*100)+'%'];
    }))}</div><div class="card"><h3>Detalle por unidad</h3>
    ${tablaCond(['Unidad','Titular','Clave CADU','Estado'],units.map(u=>[
      `${u.edificio}-${u.numero}`,u.nombre||'—',u.clave_cadu||'—',u.fondo_cadu?'Pagado a CADU':'Sin registro'
    ]))}</div>`;
}

async function vDescuentosM60() {
  const condominio=condominioActivo;
  const d=await rpc('pg_operaciones_descuentos_m60',{...C,p_condominio:condominio.id});
  if(!d.ok)throw new Error(d.error);
  if(condominio!==condominioActivo||V!=='descuentos-m60')return;
  $('vista').innerHTML=`<div class="card"><h2>Descuentos para la comunidad</h2>
    <p class="sub">El administrador decide si quiere agregar descuentos. Por ahora las propuestas se guardan en este panel; el mensaje se puede copiar para invitar a negocios o consultar el interés de los propietarios.</p>
    <form id="configDescM60"><label for="activarDescM60">¿Te gustaría agregar descuentos y convenios para las manzanas 60 y 61?</label>
      <select id="activarDescM60"><option value="false" ${!d.config.habilitado?'selected':''}>Por ahora no</option><option value="true" ${d.config.habilitado?'selected':''}>Sí, activar la sección</option></select>
      <label for="mensajeDescM60" style="margin-top:14px">Mensaje sugerido (editable)</label>
      <textarea id="mensajeDescM60" rows="5" maxlength="1000">${esc(d.config.mensaje)}</textarea>
      <div class="acts"><button class="btn sm">Guardar opción y mensaje</button><button type="button" class="btn gh sm" id="copiarDescM60">Copiar mensaje</button></div>
      <p class="sub" id="estadoDescM60" role="status"></p></form></div>
    ${d.config.habilitado?`<div class="card"><h3>Agregar propuesta de descuento</h3>
      <form id="crearDescM60" class="grid g2"><div><label for="negocioDescM60">Negocio</label><input id="negocioDescM60" maxlength="100" required></div>
      <div><label for="beneficioDescM60">Beneficio o descuento</label><input id="beneficioDescM60" maxlength="250" required></div>
      <div><label for="vigenciaDescM60">Vigencia (opcional)</label><input id="vigenciaDescM60" maxlength="150"></div>
      <div class="acts"><button class="btn sm">Guardar propuesta</button></div></form></div>`:''}
    <div class="card"><h3>Propuestas guardadas</h3>${d.descuentos.length?d.descuentos.map(x=>`<div class="item">
      <div class="ihead"><b>${esc(x.negocio)}</b><span class="pill ${x.activo?'p-ok':'p-gray'}">${x.activo?'Activa':'Oculta'}</span></div>
      <p>${esc(x.descuento)}</p><p class="sub">${esc(x.vigencia||'Sin vigencia definida')}</p>
      <div class="acts"><button class="btn gh sm cambiarDescM60" data-id="${Number(x.id)}" data-activo="${x.activo?'false':'true'}">${x.activo?'Ocultar':'Activar'}</button></div>
    </div>`).join(''):'<p class="sub">Todavía no hay descuentos.</p>'}</div>`;
  async function cambiar(cambio){const r=await rpc('pg_operaciones_descuentos_m60',{...C,p_condominio:condominio.id,p_cambio:cambio});
    if(!r.ok)throw new Error(r.error);await vDescuentosM60();}
  $('configDescM60').onsubmit=async e=>{e.preventDefault();const boton=e.currentTarget.querySelector('button');boton.disabled=true;
    try{await cambiar({accion:'configurar',habilitado:$('activarDescM60').value==='true',mensaje:$('mensajeDescM60').value.trim()});toast('Configuración guardada','good');}
    catch(error){$('estadoDescM60').textContent=error.message;boton.disabled=false;}};
  $('copiarDescM60').onclick=async()=>{try{await navigator.clipboard.writeText($('mensajeDescM60').value);toast('Mensaje copiado','good');}
    catch{ $('estadoDescM60').textContent='Selecciona y copia el mensaje manualmente.';}};
  if(d.config.habilitado)$('crearDescM60').onsubmit=async e=>{e.preventDefault();const boton=e.currentTarget.querySelector('button');boton.disabled=true;
    try{await cambiar({accion:'agregar',negocio:$('negocioDescM60').value.trim(),descuento:$('beneficioDescM60').value.trim(),vigencia:$('vigenciaDescM60').value.trim()});toast('Propuesta guardada','good');}
    catch(error){toast(error.message,'err');boton.disabled=false;}};
  $('vista').querySelectorAll('.cambiarDescM60').forEach(b=>b.onclick=async()=>{
    b.disabled=true;try{await cambiar({accion:'estado',id:b.dataset.id,activo:b.dataset.activo==='true'});toast('Descuento actualizado','good');}
    catch(error){toast(error.message,'err');b.disabled=false;}});
}

async function vRegistrosLocales(tipo) {
  const condominio = condominioActivo;
  const pantalla = V;
  const d = await operacionesLocales(condominio,tipo);
  if (V!==pantalla || condominio!==condominioActivo) return;
  const gasto = tipo==='gasto';
  $('vista').innerHTML = `
    <div class="card">
      <div class="chead"><h2>${gasto?'Gastos':'Incidencias'}</h2>
        <button class="btn sm" id="nuevoLocal">${gasto?'Registrar gasto':'Registrar incidencia'}</button></div>
      <p class="sub">${esc(condominio.nombre)} · ${gasto?money(d.resumen.gastos_mes)+' MXN este mes':esc(d.resumen.incidencias)+' abiertas'}</p>
    </div>
    ${d.registros.length?d.registros.map((r,i)=>`
      <div class="item">
        <div class="ihead"><b class="iname">${esc(r.titulo)}</b>
          <span class="pill ${r.estado==='resuelta'?'p-ok':'p-blue'}">${gasto?money(r.monto)+' MXN':esc(ESTADOS_INCIDENCIA[r.estado])}</span></div>
        <p class="sub">${[fecha(r.fecha),r.referencia,r.creado_por].filter(Boolean).map(esc).join(' · ')}</p>
        ${r.descripcion?`<p class="sub" style="white-space:pre-wrap">${esc(r.descripcion)}</p>`:''}
        ${!gasto?`<div class="acts"><button class="btn gh sm" data-estado-local="${i}">Cambiar estado</button></div>`:''}
      </div>`).join(''):`<div class="empty">${gasto?'Todavía no hay gastos registrados.':'Todavía no hay incidencias registradas.'}</div>`}`;
  $('nuevoLocal').onclick=()=>abrirRegistroLocal(condominio,tipo,d.hoy,pantalla);
  $('vista').querySelectorAll('[data-estado-local]').forEach(b=>{
    b.onclick=()=>abrirRegistroLocal(condominio,tipo,d.hoy,pantalla,d.registros[Number(b.dataset.estadoLocal)]);
  });
}

function abrirRegistroLocal(condominio,tipo,hoy,pantalla,registro) {
  const gasto = tipo==='gasto';
  sheet(`<h3>${registro?'Cambiar estado de incidencia':gasto?'Registrar gasto':'Registrar incidencia'}</h3>
    <p class="sub">${esc(condominio.nombre)}</p>
    <form id="formRegistroLocal" style="margin-top:12px">
      ${registro?`<div><label for="estadoLocal">Estado</label><select id="estadoLocal" name="estado">
        ${Object.entries(ESTADOS_INCIDENCIA).map(([k,v])=>`<option value="${k}" ${k===registro.estado?'selected':''}>${v}</option>`).join('')}
      </select></div>`:`
        <div class="grid g2">
          <div><label for="tituloLocal">${gasto?'Concepto':'Incidencia'}</label><input id="tituloLocal" name="titulo" required minlength="2" maxlength="120"></div>
          <div><label for="fechaLocal">Fecha</label><input id="fechaLocal" type="date" name="fecha" required value="${esc(hoy)}" max="${esc(hoy)}"></div>
          <div><label for="refLocal">${gasto?'Proveedor o referencia':'Edificio, unidad o área'}</label><input id="refLocal" name="referencia" maxlength="120"></div>
          ${gasto?'<div><label for="montoLocal">Importe (MXN)</label><input id="montoLocal" name="monto" type="number" min="0.01" step="0.01" required></div>':''}
          <div><label for="descLocal">Notas</label><textarea id="descLocal" name="descripcion" maxlength="1500"></textarea></div>
        </div>`}
      <p class="sub" id="mensajeLocal" role="status"></p>
      <div class="acts"><button class="btn">Guardar</button><button type="button" class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>
    </form>`);
  $('formRegistroLocal').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget, boton=form.querySelector('button'), mensaje=$('mensajeLocal');
    boton.disabled=true;
    try {
      const datos=Object.fromEntries(new FormData(form));
      const cambio=registro?{accion:'estado',id:registro.id,...datos}:{accion:'crear',...datos};
      await operacionesLocales(condominio,tipo,cambio);
      if (condominio!==condominioActivo || V!==pantalla || !$('sheetBox').contains(form)) return;
      cerrarSheet();
      toast('Registro guardado','good');
      await vRegistrosLocales(tipo);
    } catch (e) {
      mensaje.textContent=e.message;
    } finally {
      boton.disabled=false;
    }
  };
}

async function equipoCond(condominio,cambio) {
  const d=await rpc('pg_operaciones_equipo',{...C,p_condominio:condominio.id,...(cambio?{p_cambio:cambio}:{})});
  if (!d.ok) throw new Error(d.error);
  return d;
}

async function vEquipoCond() {
  const condominio=condominioActivo;
  const d=await equipoCond(condominio);
  if (V!=='equipo-cond' || condominio!==condominioActivo) return;
  $('vista').innerHTML=`
    <div class="card"><div class="chead"><h2>Accesos de ${esc(condominio.nombre)}</h2>
      <button class="btn sm" id="crearEquipo">Crear acceso</button></div>
      <p class="sub">Cada cuenta puede gestionar el padrón, las incidencias y los gastos de Manzana 60.</p>
      <p class="sub" id="errorEquipo" role="status"></p>
    </div>
    ${d.equipo.map((u,i)=>`<div class="item">
      <div class="ihead"><b class="iname">${esc(u.nombre)}</b><span class="pill ${u.activo?'p-ok':'p-gray'}">${u.activo?'Activo':'Revocado'}</span></div>
      <p class="sub">${esc(u.usuario)}</p>
      <div class="acts">
        <button class="btn gh sm" data-equipo="${i}" data-accion="restablecer">${u.activo?'Restablecer contraseña':'Reactivar acceso'}</button>
        ${u.activo?`<button class="btn gh sm" data-equipo="${i}" data-accion="revocar">Revocar acceso</button>`:''}
      </div>
    </div>`).join('')||'<div class="empty">Todavía no se han creado accesos para este equipo.</div>'}`;
  $('crearEquipo').onclick=()=>abrirCrearEquipo(condominio);
  $('vista').querySelectorAll('[data-equipo]').forEach(b=>{
    b.onclick=async()=>{
      const u=d.equipo[Number(b.dataset.equipo)], accion=b.dataset.accion, error=$('errorEquipo');
      if (!confirm(accion==='revocar'?`¿Revocar el acceso de ${u.nombre}?`:`¿Generar otra contraseña para ${u.nombre}?`)) return;
      b.disabled=true;
      try {
        const actual=await equipoCond(condominio,{accion,usuario:u.usuario});
        if (condominio!==condominioActivo || V!=='equipo-cond') return;
        if (actual.clave) mostrarAccesoEquipo(actual);
        await vEquipoCond();
      } catch(e) {
        error.textContent=e.message;
      } finally {
        b.disabled=false;
      }
    };
  });
}

function abrirCrearEquipo(condominio) {
  sheet(`<h3>Crear acceso de Manzana 60</h3>
    <form id="formEquipo" style="margin-top:12px">
      <div class="grid g2">
        <div><label for="nombreEquipo">Nombre de la persona</label><input id="nombreEquipo" required maxlength="100"></div>
        <div><label for="usuarioEquipo">Usuario después de m60.</label><input id="usuarioEquipo" required minlength="3" maxlength="41" placeholder="nombre.apellido" autocapitalize="none"></div>
      </div>
      <p class="sub" id="estadoEquipo" role="status"></p>
      <div class="acts"><button class="btn">Crear acceso</button><button type="button" class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>
    </form>`);
  $('formEquipo').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget, boton=form.querySelector('button'), estado=$('estadoEquipo');
    boton.disabled=true;
    try {
      const d=await equipoCond(condominio,{accion:'crear',nombre:$('nombreEquipo').value,
        usuario:'m60.'+$('usuarioEquipo').value.trim()});
      if (condominio!==condominioActivo || V!=='equipo-cond') return;
      mostrarAccesoEquipo(d);
      await vEquipoCond();
    } catch(e) {
      estado.textContent=e.message;
    } finally {
      boton.disabled=false;
    }
  };
}

function mostrarAccesoEquipo(d) {
  sheet(`<h3>Acceso de Manzana 60</h3>
    <p class="sub" style="margin:8px 0 12px">Copia la contraseña ahora. Volver a generarla invalida la anterior.</p>
    <label for="usuarioGenerado">Usuario</label><input id="usuarioGenerado" value="${esc(d.usuario)}" readonly>
    <label for="claveGenerada" style="margin-top:10px">Contraseña</label><input id="claveGenerada" value="${esc(d.clave)}" readonly>
    <p class="sub" style="margin-top:10px"><a href="/operaciones/manzana-60">Abrir el panel de Manzana 60</a></p>
    <div class="acts"><button class="btn gh" id="cerrarCredencial">Cerrar</button></div>`);
  $('cerrarCredencial').onclick=cerrarSheet;
}

prepararAccesoPanel();
