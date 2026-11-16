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
  {k:'incidencias-locales',t:'Incidencias',i:'🔧'},
  {k:'gastos-locales',t:'Gastos',i:'🧾'}
];
const ESTADOS_INCIDENCIA = {pendiente:'Pendiente',en_proceso:'En proceso',resuelta:'Resuelta'};

function nombrePanel() {
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
  const [padron,local] = await Promise.all([datosPadron(condominio.id),operacionesLocales(condominio,'incidencia')]);
  if (V!=='resumen-local' || condominio!==condominioActivo) return;
  $('vista').innerHTML = `
    <div class="card"><h2>${esc(condominio.nombre)}</h2><p class="sub">Panel de administración del condominio.</p></div>
    <div class="kpis">
      ${kpiPanel('Unidades activas',padron.unidades)}
      ${kpiPanel('Propietarios',agruparPropietarios(padron.padron).length)}
      ${kpiPanel('Solicitudes por revisar',padron.solicitudes.length)}
      ${kpiPanel('Incidencias abiertas',local.resumen.incidencias)}
      ${kpiPanel('Gastos del mes',money(local.resumen.gastos_mes))}
    </div>
    <div class="card"><h3>Padrón y operación diaria</h3><div class="acts">
      <button class="btn" data-local-nav="archivos">Subir padrón de propietarios</button>
      <button class="btn gh" data-local-nav="propietarios">Revisar solicitudes</button>
      <button class="btn gh" data-local-nav="incidencias-locales">Ver incidencias</button>
      <button class="btn gh" data-local-nav="gastos-locales">Ver gastos</button>
    </div></div>`;
  $('vista').querySelectorAll('[data-local-nav]').forEach(b=>b.onclick=()=>ir(b.dataset.localNav));
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
