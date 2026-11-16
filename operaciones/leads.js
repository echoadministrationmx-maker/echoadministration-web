'use strict';

// Pestaña "Leads" del panel de operaciones (solo plataforma).
const TIPOS_LEAD = {comite:'Comité', inversionista:'Inversionista', administrador:'Administrador', convenio:'Convenio', departamento:'Interés en depto'};
const ESTADOS_LEAD = {nuevo:'Nuevo', contactado:'Contactado', en_proceso:'En proceso', ganado:'Ganado', descartado:'Descartado'};
const PILL_ESTADO_LEAD = {nuevo:'p-amb', contactado:'p-blue', en_proceso:'p-blue', ganado:'p-ok', descartado:'p-gray'};
let filtroLeadTipo = '', filtroLeadEstado = '', filtroLeadFuente = '', consultaLead = '', periodoLead = '30';

async function datosLeads(accion) {
  const args = {...C};
  if (accion) args.p_accion = accion;
  const d = await rpc('pg_operaciones_leads', args);
  if (!d || !d.ok) throw new Error((d && d.error) || 'No se pudieron cargar los leads.');
  return d;
}

// Fuente legible: utm_source > dominio del referrer > Directo.
function fuenteLead(l) {
  if (l.utm_source) return l.utm_source.toLowerCase();
  if (l.referrer) {
    try {
      const h = new URL(l.referrer).hostname.replace(/^www\.|^m\.|^l\./, '');
      if (/google\./.test(h)) return 'google';
      if (/facebook\.com|fb\.com/.test(h)) return 'facebook';
      if (/instagram\.com/.test(h)) return 'instagram';
      if (/linkedin\.com|lnkd\.in/.test(h)) return 'linkedin';
      if (/t\.co$|twitter\.com|x\.com/.test(h)) return 'x';
      if (/tiktok\.com/.test(h)) return 'tiktok';
      return h;
    } catch (e) { return 'otro sitio'; }
  }
  return 'directo';
}

function contarPor(lista, fn) {
  const m = new Map();
  lista.forEach(x => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function barrasLead(titulo, pares, total) {
  if (!pares.length) return '';
  return `<div class="card"><h3 style="margin-bottom:10px">${esc(titulo)}</h3>${pares.slice(0, 8).map(([k, n]) => `
    <div style="display:grid;grid-template-columns:130px 1fr 40px;gap:10px;align-items:center;margin:7px 0;font-size:.86rem">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k)}</span>
      <span style="display:block;height:8px;border-radius:99px;background:#EEF3FF;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(4, Math.round(n / total * 100))}%;background:var(--blue);border-radius:99px"></span></span>
      <b style="text-align:right">${n}</b>
    </div>`).join('')}</div>`;
}

async function vLeads() {
  const d = await datosLeads();
  if (V !== 'leads') return;
  $('vista').innerHTML = `
    <div class="card">
      <div class="chead"><h2>Leads</h2><button class="btn gh sm" id="exportarLeads">Descargar CSV</button></div>
      <p class="sub">Todo lo que llega de la página principal, aliados e inversionistas, administradores, convenios y el catálogo de departamentos. Se guarda aunque la persona no envíe el WhatsApp.</p>
    </div>
    <div class="card"><div class="grid g2">
      <div><label for="leadBuscar">Buscar por nombre, teléfono, empresa o ciudad</label><input id="leadBuscar" type="search" value="${esc(consultaLead)}"></div>
      <div><label for="leadPeriodo">Periodo</label><select id="leadPeriodo">${opcionesRegistro({'7':'Últimos 7 días','30':'Últimos 30 días','90':'Últimos 90 días','':'Todo'}, periodoLead)}</select></div>
      <div><label for="leadTipo">Tipo</label><select id="leadTipo">${opcionesRegistro({'':'Todos', ...TIPOS_LEAD}, filtroLeadTipo)}</select></div>
      <div><label for="leadEstado">Estado</label><select id="leadEstado">${opcionesRegistro({'':'Todos', ...ESTADOS_LEAD}, filtroLeadEstado)}</select></div>
    </div></div>
    <div id="leadsResumen"></div>
    <div id="leadsLista"></div>`;

  let visibles = [];
  function pintar() {
    const q = consultaLead.trim().toLocaleLowerCase('es-MX');
    const desde = periodoLead ? Date.now() - Number(periodoLead) * 864e5 : 0;
    const enPeriodo = d.leads.filter(l => new Date(l.creado_at).getTime() >= desde);
    visibles = enPeriodo.filter(l =>
      (!filtroLeadTipo || l.tipo === filtroLeadTipo) &&
      (!filtroLeadEstado || l.estado === filtroLeadEstado) &&
      (!filtroLeadFuente || fuenteLead(l) === filtroLeadFuente) &&
      [l.nombre, l.telefono, l.email, l.empresa, l.ciudad, l.datos && l.datos.titulo].join(' ').toLocaleLowerCase('es-MX').includes(q));

    const conContacto = enPeriodo.filter(l => l.tipo !== 'departamento');
    $('leadsResumen').innerHTML = `
      <div class="kpis">
        ${kpiPanel('Leads en el periodo', conContacto.length)}
        ${kpiPanel('Nuevos sin atender', conContacto.filter(l => l.estado === 'nuevo').length)}
        ${kpiPanel('Comités', enPeriodo.filter(l => l.tipo === 'comite').length)}
        ${kpiPanel('Inversionistas', enPeriodo.filter(l => l.tipo === 'inversionista').length)}
        ${kpiPanel('Clics "Me interesa"', enPeriodo.filter(l => l.tipo === 'departamento').length)}
      </div>
      <div class="grid g2">
        ${barrasLead('¿De dónde vienen?', contarPor(enPeriodo, fuenteLead), enPeriodo.length)}
        ${barrasLead('Campañas', contarPor(enPeriodo.filter(l => l.utm_campaign), l => l.utm_campaign), enPeriodo.length)}
        ${barrasLead('Página donde se capturó', contarPor(enPeriodo, l => (l.pagina || '/').split('?')[0]), enPeriodo.length)}
        ${barrasLead('Por tipo', contarPor(enPeriodo, l => TIPOS_LEAD[l.tipo] || l.tipo), enPeriodo.length)}
      </div>
      ${filtroLeadFuente ? `<p class="sub" style="margin:4px 0 10px">Filtrando por fuente <b>${esc(filtroLeadFuente)}</b> · <a href="#" id="quitarFuente">quitar</a></p>` : ''}`;
    $('leadsResumen').querySelectorAll('.card').forEach((card, i) => {
      if (i !== 0) return; // la primera tarjeta es "¿De dónde vienen?": permite filtrar al hacer clic
      card.querySelectorAll('div[style*="grid-template-columns"]').forEach(fila => {
        fila.style.cursor = 'pointer';
        fila.onclick = () => { filtroLeadFuente = fila.querySelector('span').textContent; pintar(); };
      });
    });
    if ($('quitarFuente')) $('quitarFuente').onclick = e => { e.preventDefault(); filtroLeadFuente = ''; pintar(); };

    $('leadsLista').innerHTML = visibles.length ? visibles.map((l, i) => `
      <div class="item">
        <div class="ihead"><b class="iname">${esc(l.nombre || l.empresa || (l.datos && l.datos.titulo) || 'Sin nombre')}</b>
          <span class="pill ${PILL_ESTADO_LEAD[l.estado] || 'p-gray'}">${esc(ESTADOS_LEAD[l.estado] || l.estado)}</span></div>
        <p class="sub">${esc(TIPOS_LEAD[l.tipo] || l.tipo)} · ${esc(fecha(l.creado_at))} ${new Date(l.creado_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute: '2-digit'})} · Fuente: <b>${esc(fuenteLead(l))}</b>${l.utm_campaign ? ' · ' + esc(l.utm_campaign) : ''}</p>
        <p class="sub">${esc([l.telefono, l.email, l.empresa, l.ciudad].filter(Boolean).join(' · ') || (l.datos && l.datos.titulo) || '')}</p>
        <div class="acts">
          <button class="btn gh sm" data-ver-lead="${i}">Ver detalle</button>
          ${l.telefono ? `<a class="btn gh sm" target="_blank" rel="noopener" href="https://wa.me/${esc(String(l.telefono).replace(/\D/g, ''))}">WhatsApp</a>` : ''}
        </div>
      </div>`).join('') : '<div class="empty">No hay leads con estos filtros.</div>';
    $('leadsLista').querySelectorAll('[data-ver-lead]').forEach(b => b.onclick = () => verLead(visibles[Number(b.dataset.verLead)]));
  }

  $('leadBuscar').oninput = e => { consultaLead = e.target.value; pintar(); };
  $('leadPeriodo').onchange = e => { periodoLead = e.target.value; pintar(); };
  $('leadTipo').onchange = e => { filtroLeadTipo = e.target.value; pintar(); };
  $('leadEstado').onchange = e => { filtroLeadEstado = e.target.value; pintar(); };
  $('exportarLeads').onclick = () => exportarLeadsCsv(visibles);
  pintar();
}

function verLead(l) {
  const extra = Object.entries(l.datos || {}).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`).join('');
  sheet(`<h3>${esc(l.nombre || l.empresa || 'Lead')}</h3>
    <p class="sub">${esc(TIPOS_LEAD[l.tipo] || l.tipo)} · ${esc(fecha(l.creado_at))}</p>
    <div class="dl">
      <div><b>Teléfono</b><span>${esc(l.telefono || '—')}</span></div>
      <div><b>Correo</b><span>${esc(l.email || '—')}</span></div>
      <div><b>Empresa</b><span>${esc(l.empresa || '—')}</span></div>
      <div><b>Ciudad</b><span>${esc(l.ciudad || '—')}</span></div>
      ${extra}
      <div><b>Fuente</b><span>${esc(fuenteLead(l))}</span></div>
      <div><b>Medio / campaña</b><span>${esc([l.utm_medium, l.utm_campaign, l.utm_content].filter(Boolean).join(' · ') || '—')}</span></div>
      <div><b>Llegó desde</b><span>${esc(l.referrer || 'Directo')}</span></div>
      <div><b>Primera página</b><span>${esc(l.landing || '—')}</span></div>
      <div><b>Capturado en</b><span>${esc(l.pagina || '—')}</span></div>
    </div>
    ${l.mensaje ? `<p class="sub" style="white-space:pre-wrap;margin-top:10px">${esc(l.mensaje)}</p>` : ''}
    <form id="formLead" style="margin-top:13px">
      <label for="leadNuevoEstado">Estado</label><select id="leadNuevoEstado">${opcionesRegistro(ESTADOS_LEAD, l.estado)}</select>
      <label for="leadNota" style="margin-top:8px">Nota interna</label><textarea id="leadNota" rows="2" maxlength="2000">${esc(l.nota || '')}</textarea>
      <div class="acts" style="margin-top:10px"><button class="btn sm" type="submit">Guardar</button>
        ${l.telefono ? `<a class="btn gh sm" target="_blank" rel="noopener" href="https://wa.me/${esc(String(l.telefono).replace(/\D/g, ''))}">Abrir WhatsApp</a>` : ''}</div>
    </form>`);
  const form = $('formLead');
  form.onsubmit = async e => {
    e.preventDefault();
    const boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    try {
      await datosLeads({tipo: 'actualizar', id: l.id, estado: $('leadNuevoEstado').value, nota: $('leadNota').value});
      if (V !== 'leads' || !form.isConnected) return;
      toast('Lead actualizado', 'good');
      cerrarSheet();
      vLeads();
    } catch (err) {
      toast(err.message, 'err');
    } finally { boton.disabled = false; }
  };
}

function exportarLeadsCsv(lista) {
  const cols = ['creado_at', 'tipo', 'estado', 'nombre', 'telefono', 'email', 'empresa', 'ciudad', 'mensaje', 'fuente', 'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing', 'pagina', 'nota'];
  const celda = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const filas = lista.map(l => cols.map(c => celda(c === 'fuente' ? fuenteLead(l) : l[c])).join(','));
  const blob = new Blob(['﻿' + [cols.join(','), ...filas].join('\n')], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads-echo.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
