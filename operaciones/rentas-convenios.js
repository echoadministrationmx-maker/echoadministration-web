'use strict';

const PLAZOS_RENTA = {corto:'Corto plazo', mediano:'Mediano plazo', largo:'Largo plazo'};
const ESTADOS_RENTA = {pendiente:'Por revisar', aprobada:'Aprobada', rechazada:'Rechazada', archivada:'Archivada'};
const ESTADOS_NEGOCIO = {pendiente:'Por revisar', contactado:'Contactado', aceptado:'Aceptado', rechazado:'Rechazado'};
const filtrosRentas = new Map();
let filtroNegocios = 'pendiente';
let consultaNegocios = '';

function opcionesRegistro(valores, actual) {
  return Object.entries(valores).map(([valor,texto]) =>
    `<option value="${esc(valor)}"${valor===actual?' selected':''}>${esc(texto)}</option>`
  ).join('');
}

function enlaceRegistro(url, etiqueta) {
  if (!url) return '';
  try {
    const enlace = new URL(url);
    if (enlace.protocol!=='https:' && enlace.protocol!=='http:') return '';
    return `<a href="${esc(enlace.href)}" target="_blank" rel="noopener noreferrer">${esc(etiqueta)}</a>`;
  } catch {
    return '';
  }
}

function tarifaRegistro(renta) {
  return renta.precio==null ? '—' : `${money(renta.precio)} MXN por ${renta.periodo_precio}`;
}

async function datosRentas(condominio, accion) {
  const args = {...C,p_condominio:condominio.id};
  if (accion) args.p_accion = accion;
  const d = await rpc('pg_operaciones_registros_renta', args);
  if (!d.ok) throw new Error(d.error);
  return d;
}

async function vInventarioRentas() {
  const condominio = condominioActivo;
  const d = await datosRentas(condominio);
  if (V!=='inventario-rentas' || condominioActivo!==condominio) return;
  const filtros = filtrosRentas.get(condominio.id) || {plazo:'',estado:'vigentes',texto:''};
  filtrosRentas.set(condominio.id,filtros);
  const activas = d.registros.filter(r=>r.estado==='aprobada'||r.origen==='vacacional');
  const pendientes = d.registros.filter(r=>r.estado==='pendiente').length;
  $('vista').innerHTML = `
    <div class="card">
      <div class="chead"><h2>Departamentos en renta · ${esc(condominio.nombre)}</h2>
        <a class="btn gh sm" href="/registrar-departamento?manzana=${encodeURIComponent(condominio.codigo)}" target="_blank" rel="noopener">Abrir formulario de renta</a>
      </div>
      <p class="sub">Revisa las solicitudes y controla qué unidades están disponibles o rentadas.</p>
    </div>
    <div class="kpis">
      ${Object.entries(PLAZOS_RENTA).map(([k,t])=>kpiPanel(t,activas.filter(r=>r.plazos.includes(k)).length)).join('')}
      ${kpiPanel('Por revisar',pendientes)}
    </div>
    <div class="card">
      <div class="grid g3">
        <div><label for="buscarRenta">Buscar unidad, edificio o título</label><input id="buscarRenta" type="search" value="${esc(filtros.texto)}"></div>
        <div><label for="plazoRenta">Plazo</label><select id="plazoRenta">${opcionesRegistro({'':'Todos los plazos',...PLAZOS_RENTA},filtros.plazo)}</select></div>
        <div><label for="estadoRenta">Estado</label><select id="estadoRenta">${opcionesRegistro({
          vigentes:'Vigentes y por revisar',pendiente:'Por revisar',disponible:'Disponibles',rentado:'Rentados',
          aprobada:'Aprobadas / programa vacacional',rechazada:'Rechazadas',archivada:'Archivadas','':'Todos'
        },filtros.estado)}</select></div>
      </div>
      <p class="sub" id="conteoRentas" style="margin-top:8px" role="status"></p>
    </div>
    <div id="listaRentas"></div>`;

  function pintarRentas() {
    const consulta = filtros.texto.trim().toLocaleLowerCase('es-MX');
    const visibles = d.registros.filter(r=>{
      const vigente = r.estado==='aprobada'||r.origen==='vacacional';
      const pasaEstado = {
        vigentes: vigente||r.estado==='pendiente',
        aprobada: vigente,
        disponible: vigente&&r.situacion==='disponible',
        rentado: vigente&&r.situacion==='rentado'
      }[filtros.estado] ?? (!filtros.estado||r.estado===filtros.estado);
      return pasaEstado && (!filtros.plazo||r.plazos.includes(filtros.plazo)) &&
        [r.edificio,r.unidad,r.titulo].join(' ').toLocaleLowerCase('es-MX').includes(consulta);
    });
    $('conteoRentas').textContent = `${visibles.length} de ${d.registros.length} registros`;
    const lista = $('listaRentas');
    lista.innerHTML = visibles.length ? visibles.map((r,i)=>`
      <div class="item">
        <div class="ihead"><span class="tag">${esc(r.edificio)} · ${esc(r.unidad)}</span><b class="iname">${esc(r.titulo)}</b>
          <span class="pill ${r.estado==='pendiente'?'p-amb':'p-blue'}">${esc(ESTADOS_RENTA[r.estado]||'Programa vacacional')}</span></div>
        <p class="sub">${esc(r.plazos.map(p=>PLAZOS_RENTA[p]).join(' · '))}
          · ${esc(r.situacion==='rentado'?'Rentado':r.situacion==='disponible'?'Disponible':'Disponibilidad en el programa vacacional')}</p>
        <p class="sub">${esc(tarifaRegistro(r))}${r.fecha_disponible?' · Disponible desde '+esc(fecha(r.fecha_disponible)):''}</p>
        ${r.origen==='registro'? `<div class="acts"><button class="btn gh sm" data-ver-renta="${i}">Ver detalle</button></div>` : ''}
      </div>`).join('') : '<div class="empty">No hay departamentos que coincidan con la búsqueda.</div>';
    lista.querySelectorAll('[data-ver-renta]').forEach(b=>{
      b.onclick=()=>verRegistroRenta(condominio,visibles[Number(b.dataset.verRenta)].id,b);
    });
  }

  $('buscarRenta').oninput=e=>{filtros.texto=e.target.value;pintarRentas();};
  $('plazoRenta').onchange=e=>{filtros.plazo=e.target.value;pintarRentas();};
  $('estadoRenta').onchange=e=>{filtros.estado=e.target.value;pintarRentas();};
  pintarRentas();
}

async function verRegistroRenta(condominio,id,origen) {
  origen.disabled=true;
  try {
    const d=await datosRentas(condominio,{tipo:'detalle',id});
    if (V!=='inventario-rentas' || condominioActivo!==condominio || !origen.isConnected) return;
    const r=d.registro;
    const acciones = r.estado==='pendiente'
      ? [['estado','aprobada','Aprobar registro'],['estado','rechazada','Rechazar']]
      : r.estado==='aprobada'
        ? [['situacion',r.situacion==='rentado'?'disponible':'rentado',r.situacion==='rentado'?'Marcar disponible':'Marcar rentado'],['estado','archivada','Archivar']]
        : [];
    sheet(`<h3>${esc(r.titulo)}</h3>
      <p class="sub">${esc(condominio.nombre)} · ${esc(r.edificio)} · ${esc(r.unidad)}</p>
      <div class="dl">
        <div><b>Plazos</b><span>${esc(r.plazos.map(p=>PLAZOS_RENTA[p]).join(' · '))}</span></div>
        <div><b>Situación</b><span>${r.situacion==='rentado'?'Rentado':'Disponible'}</span></div>
        <div><b>Precio</b><span>${esc(tarifaRegistro(r))}</span></div>
        <div><b>Desde</b><span>${esc(fecha(r.fecha_disponible))}</span></div>
        <div><b>Habitaciones</b><span>${esc(r.habitaciones??'—')}</span></div>
        <div><b>Baños</b><span>${esc(r.banos??'—')}</span></div>
        <div><b>Contacto</b><span>${esc(r.contacto)}</span></div>
        <div><b>Correo</b><span>${esc(r.email||'—')}</span></div>
        <div><b>Teléfono</b><span>${esc(r.telefono||'—')}</span></div>
      </div>
      ${r.descripcion?`<p class="sub" style="margin-top:12px;white-space:pre-wrap">${esc(r.descripcion)}</p>`:''}
      <p class="sub" style="margin-top:10px">${enlaceRegistro(r.enlace,'Abrir anuncio existente')}</p>
      ${d.fotos.length?`<div class="grid g2" style="margin-top:12px">${d.fotos.map((foto,i)=>
        `<img src="data:image/jpeg;base64,${esc(foto)}" alt="Foto ${i+1} del departamento" loading="lazy" style="width:100%;max-height:210px;object-fit:contain;border-radius:8px;background:#f4f6f9">`
      ).join('')}</div>`:''}
      <p id="rentaDetalleError" class="sub" role="status"></p>
      <div class="acts">${acciones.map((a,i)=>`<button class="btn ${i?'gh':''}" data-renta-accion="${i}">${esc(a[2])}</button>`).join('')}
        <button class="btn gh" onclick="cerrarSheet()">Cerrar</button>
      </div>`);
    $('sheetBox').querySelectorAll('[data-renta-accion]').forEach(b=>{
      b.onclick=async()=>{
        const [tipo,valor,etiqueta]=acciones[Number(b.dataset.rentaAccion)];
        const estado=$('rentaDetalleError');
        if (!confirm(`¿${etiqueta}?`)) return;
        const botones=$('sheetBox').querySelectorAll('[data-renta-accion]');
        botones.forEach(a=>a.disabled=true);
        try {
          await datosRentas(condominio,{tipo,valor,id});
          if (condominioActivo!==condominio || V!=='inventario-rentas' || !estado.isConnected) return;
          cerrarSheet();
          toast('Registro actualizado','good');
          await vInventarioRentas();
        } catch(e) {
          estado.textContent=e.message;
        } finally {
          botones.forEach(a=>a.disabled=false);
        }
      };
    });
  } catch(e) {
    if (condominioActivo===condominio && V==='inventario-rentas') toast(e.message,'err');
  } finally {
    origen.disabled=false;
  }
}

async function datosNegocios(accion) {
  const args={...C};
  if (accion) args.p_accion=accion;
  const d=await rpc('pg_operaciones_solicitudes_negocios',args);
  if (!d.ok) throw new Error(d.error);
  return d;
}

async function vSolicitudesNegocios() {
  const d=await datosNegocios();
  if (V!=='negocios-convenios') return;
  $('vista').innerHTML=`
    <div class="card">
      <div class="chead"><h2>Solicitudes de convenios</h2>
        <a class="btn gh sm" href="/registrar-negocio" target="_blank" rel="noopener">Abrir formulario de negocios</a>
      </div>
      <p class="sub">Revisa los beneficios propuestos y da seguimiento a cada negocio.</p>
    </div>
    <div class="card"><div class="grid g2">
      <div><label for="buscarNegocio">Buscar por negocio, ciudad o categoría</label><input id="buscarNegocio" type="search" value="${esc(consultaNegocios)}"></div>
      <div><label for="estadoNegocio">Estado</label><select id="estadoNegocio">${opcionesRegistro({'':'Todos',...ESTADOS_NEGOCIO},filtroNegocios)}</select></div>
    </div></div>
    <div id="listaNegocios"></div>`;
  function pintarNegocios() {
    const q=consultaNegocios.trim().toLocaleLowerCase('es-MX');
    const visibles=d.negocios.filter(n=>(!filtroNegocios||n.estado===filtroNegocios)&&
      [n.nombre,n.ciudad,n.categoria].join(' ').toLocaleLowerCase('es-MX').includes(q));
    const lista=$('listaNegocios');
    lista.innerHTML=visibles.length?visibles.map((n,i)=>`
      <div class="item">
        <div class="ihead"><b class="iname">${esc(n.nombre)}</b><span class="pill p-blue">${esc(ESTADOS_NEGOCIO[n.estado])}</span></div>
        <p class="sub">${esc(n.ciudad)} · ${esc(n.categoria)}</p><p>${esc(n.beneficio)}</p>
        <div class="acts"><button class="btn gh sm" data-ver-negocio="${i}">Ver propuesta</button></div>
      </div>`).join(''):'<div class="empty">No hay propuestas que coincidan con la búsqueda.</div>';
    lista.querySelectorAll('[data-ver-negocio]').forEach(b=>b.onclick=()=>verPropuestaNegocio(visibles[Number(b.dataset.verNegocio)]));
  }
  $('buscarNegocio').oninput=e=>{consultaNegocios=e.target.value;pintarNegocios();};
  $('estadoNegocio').onchange=e=>{filtroNegocios=e.target.value;pintarNegocios();};
  pintarNegocios();
}

function verPropuestaNegocio(n) {
  sheet(`<h3>${esc(n.nombre)}</h3><p class="sub">${esc(n.ciudad)} · ${esc(n.categoria)}</p>
    <div class="dl">
      <div><b>Contacto</b><span>${esc(n.contacto)}</span></div>
      <div><b>Correo</b><span>${esc(n.email||'—')}</span></div>
      <div><b>Teléfono</b><span>${esc(n.telefono||'—')}</span></div>
      <div><b>Vigencia</b><span>${esc(fecha(n.vigencia))}</span></div>
    </div>
    ${n.direccion?`<p class="sub">${esc(n.direccion)}</p>`:''}
    <p class="sub" style="margin-top:8px">${enlaceRegistro(n.enlace,'Abrir enlace del negocio')}</p>
    <p style="margin-top:10px;white-space:pre-wrap">${esc(n.beneficio)}</p>
    ${n.condiciones?`<p class="sub" style="white-space:pre-wrap">${esc(n.condiciones)}</p>`:''}
    <form id="editarNegocio" style="margin-top:12px">
      <label for="revisionNegocio">Estado de seguimiento</label>
      <select id="revisionNegocio">${opcionesRegistro(ESTADOS_NEGOCIO,n.estado)}</select>
      <p id="errorNegocio" class="sub" role="status"></p>
      <div class="acts"><button class="btn">Guardar estado</button><button type="button" class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>
    </form>`);
  $('editarNegocio').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget, boton=form.querySelector('button'), error=$('errorNegocio');
    boton.disabled=true;
    try {
      await datosNegocios({id:n.id,estado:$('revisionNegocio').value});
      if (V!=='negocios-convenios' || !form.isConnected) return;
      cerrarSheet();
      toast('Propuesta actualizada','good');
      await vSolicitudesNegocios();
    } catch(e) {
      error.textContent=e.message;
    } finally {
      boton.disabled=false;
    }
  };
}
