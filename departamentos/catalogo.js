'use strict';

// Catálogo público de departamentos.
// El servidor pagina de 8 en 8 y filtra por operación y texto; el filtro por plazo
// (por días / por mes / largo plazo) se aplica aquí sobre las publicaciones descargadas.

const porId = id => document.getElementById(id);
const dialogo = porId('detalle');
const POR_PAGINA = 9;
const MAX_PAGINAS_SERVIDOR = 15; // hasta 120 publicaciones por búsqueda
const WA = '522206808919';

const ETIQUETAS_PLAZO = { corto: 'Por días', mediano: 'Por mes', largo: 'Largo plazo' };
const PERIODOS = { noche: 'noche', semana: 'semana', mes: 'mes' };

let filtro = 'todos';
let pagina = 0;
let consulta = 0;
let detalleConsulta = 0;
let todas = [];
let cacheClave = null;

const esc = inmuebleEsc;

function etiqueta(d) {
  if (d.operacion === 'venta') return 'Venta';
  return ETIQUETAS_PLAZO[d.plazo] || 'Renta';
}

function precio(d) {
  if (d.precio == null || d.precio === '') return '';
  const n = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(d.precio);
  const p = d.periodo && PERIODOS[d.periodo] ? ` <small>/ ${PERIODOS[d.periodo]}</small>` : '';
  return n + p;
}

function caracteristicas(d) {
  return [
    d.habitaciones != null ? `${d.habitaciones} ${d.habitaciones == 1 ? 'recámara' : 'recámaras'}` : '',
    d.banos != null ? `${d.banos} ${d.banos == 1 ? 'baño' : 'baños'}` : ''
  ].filter(Boolean);
}

function cumpleFiltro(p) {
  const d = p.datos;
  if (filtro === 'todos') return true;
  if (filtro === 'venta') return d.operacion === 'venta';
  return d.operacion === 'renta' && d.plazo === filtro;
}

async function descargar(operacion, busqueda) {
  const lista = [];
  for (let i = 0; i < MAX_PAGINAS_SERVIDOR; i++) {
    const d = await inmuebleRpc('echo_catalogo_inmuebles', { p_operacion: operacion, p_busqueda: busqueda, p_pagina: i });
    lista.push(...d.publicaciones);
    if (!d.hay_mas) break;
  }
  return lista;
}

function tarjeta(p) {
  const d = p.datos;
  const extra = caracteristicas(d).join(' · ');
  return `<button class="item" type="button" data-inmueble="${p.id}" aria-label="Ver ${esc(d.titulo)}">
    <div class="ph">
      ${p.foto ? `<img alt="" loading="lazy" src="data:image/jpeg;base64,${esc(p.foto)}">`
               : `<div class="none"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg></div>`}
      <span class="badge ${d.operacion === 'venta' ? 'venta' : ''}">${esc(etiqueta(d))}</span>
    </div>
    <div class="body">
      <h3>${esc(d.titulo)}</h3>
      <div class="loc">${esc([d.zona, d.ciudad].filter(Boolean).join(' · '))}</div>
      ${extra ? `<div class="meta">${esc(extra)}</div>` : ''}
      <div class="price">${precio(d)}</div>
    </div>
  </button>`;
}

function pintar() {
  const filtradas = todas.filter(cumpleFiltro);
  const total = filtradas.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  pagina = Math.min(pagina, paginas - 1);
  const visibles = filtradas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  porId('estado').textContent = total ? `${total} ${total === 1 ? 'departamento' : 'departamentos'}` : '';
  porId('resultados').innerHTML = visibles.length ? visibles.map(tarjeta).join('') : `
    <div class="empty">
      <h3>Por ahora no hay departamentos aquí</h3>
      <p>Prueba otro filtro o vuelve pronto. ¿Tienes uno disponible?</p>
      <a class="btn btn-primary" href="/publicar-departamento">Publicar el mío →</a>
    </div>`;
  porId('resultados').querySelectorAll('[data-inmueble]').forEach(b => b.onclick = () => verInmueble(Number(b.dataset.inmueble)));
  porId('anterior').hidden = pagina === 0;
  porId('siguiente').hidden = pagina >= paginas - 1;
}

async function cargar() {
  const peticion = ++consulta;
  const operacion = filtro === 'venta' ? 'venta' : (filtro === 'todos' ? null : 'renta');
  const busqueda = porId('busqueda').value.trim();
  const clave = (operacion || '') + '|' + busqueda;
  if (clave === cacheClave) { pintar(); return; }

  porId('estado').textContent = 'Cargando…';
  porId('resultados').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  porId('anterior').hidden = porId('siguiente').hidden = true;
  try {
    const lista = await descargar(operacion, busqueda);
    if (peticion !== consulta) return;
    todas = lista;
    cacheClave = clave;
    pintar();
  } catch (error) {
    if (peticion !== consulta) return;
    porId('estado').textContent = '';
    porId('resultados').innerHTML = `<div class="empty"><h3>No pudimos cargar los departamentos</h3><p>${esc(error.message)}</p><button class="btn btn-ghost" type="button" onclick="cacheClave=null;cargar()">Intentar de nuevo</button></div>`;
  }
}

async function verInmueble(id) {
  const peticion = ++detalleConsulta;
  porId('contenido').innerHTML = '<button class="x" type="button" aria-label="Cerrar" onclick="dialogo.close()">×</button><h2 id="titulo-inmueble">Cargando…</h2>';
  if (!dialogo.open) dialogo.showModal();
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  history.replaceState(null, '', url);
  try {
    const r = await inmuebleRpc('echo_catalogo_inmuebles', { p_id: id });
    if (peticion !== detalleConsulta || !dialogo.open) return;
    const d = r.datos;
    const facts = [etiqueta(d), ...caracteristicas(d)];
    const msg = `Hola Echo, me interesa el departamento "${d.titulo}" (${etiqueta(d)}, ficha ${id}). ${location.origin}/departamentos?id=${id}`;
    const asunto = encodeURIComponent(`Echo · ${etiqueta(d)} · departamento ${id}`);
    porId('contenido').innerHTML = `
      <button class="x" type="button" aria-label="Cerrar" onclick="dialogo.close()">×</button>
      <div class="eyebrow" style="margin-bottom:0">${esc([d.zona, d.ciudad, d.region].filter(Boolean).join(' · '))}</div>
      <h2 id="titulo-inmueble">${esc(d.titulo)}</h2>
      <div class="price" style="font-size:22px;font-weight:600;color:var(--ink)">${precio(d)}</div>
      <div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>
      ${r.fotos && r.fotos.length ? `<div class="gal">${r.fotos.map((f, i) => `<img alt="Foto ${i + 1}" loading="lazy" src="data:image/jpeg;base64,${esc(f)}">`).join('')}</div>` : ''}
      <p class="desc">${esc(d.descripcion)}</p>
      <div class="acts">
        <a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/${WA}?text=${encodeURIComponent(msg)}">Me interesa · WhatsApp</a>
        <a class="btn btn-ghost" href="mailto:echoadministrationmx@gmail.com?subject=${asunto}">Escribir por correo</a>
      </div>`;
  } catch (error) {
    if (peticion === detalleConsulta && dialogo.open) porId('contenido').innerHTML = `<button class="x" type="button" aria-label="Cerrar" onclick="dialogo.close()">×</button><h2 id="titulo-inmueble">${esc(error.message)}</h2>`;
  }
}

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  filtro = t.dataset.f;
  pagina = 0;
  const u = new URL(location.href);
  if (filtro === 'todos') u.searchParams.delete('tipo'); else u.searchParams.set('tipo', filtro);
  history.replaceState(null, '', u);
  cargar();
});
porId('filtros').onsubmit = e => { e.preventDefault(); pagina = 0; cacheClave = null; cargar(); };
porId('anterior').onclick = () => { pagina = Math.max(0, pagina - 1); pintar(); scrollTo({ top: porId('resultados').offsetTop - 160, behavior: 'smooth' }); };
porId('siguiente').onclick = () => { pagina++; pintar(); scrollTo({ top: porId('resultados').offsetTop - 160, behavior: 'smooth' }); };
dialogo.addEventListener('click', e => { if (e.target === dialogo) dialogo.close(); });
dialogo.onclose = () => {
  detalleConsulta++;
  const url = new URL(location.href);
  url.searchParams.delete('id');
  history.replaceState(null, '', url);
  porId('contenido').replaceChildren();
};

// Enlaces directos: /departamentos?tipo=corto|mediano|largo|venta  y  ?id=123
const params = new URLSearchParams(location.search);
const tipoInicial = params.get('tipo');
if (['corto', 'mediano', 'largo', 'venta'].includes(tipoInicial)) {
  filtro = tipoInicial;
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x.dataset.f === filtro)));
}
cargar();
const destacado = params.get('id');
if (/^[0-9]{1,14}$/.test(destacado || '')) verInmueble(Number(destacado));
