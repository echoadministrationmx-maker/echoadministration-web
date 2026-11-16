'use strict';

const porId = id=>document.getElementById(id);
const dialogo=porId('detalle');
let pagina=0;
let consulta=0;
let detalleConsulta=0;

async function cargarCatalogo() {
  const peticion=++consulta;
  porId('estado').textContent='Cargando departamentos…';
  porId('resultados').replaceChildren();
  porId('anterior').hidden=true;
  porId('siguiente').hidden=true;
  try {
    const d=await inmuebleRpc('echo_catalogo_inmuebles',{
      p_operacion:porId('operacion').value||null,p_busqueda:porId('busqueda').value.trim(),p_pagina:pagina
    });
    if(peticion!==consulta)return;
    porId('estado').textContent=d.publicaciones.length?'':'Por ahora no hay departamentos que coincidan con tu búsqueda.';
    porId('resultados').innerHTML=d.publicaciones.map(p=>`
      <article class="ficha">
        ${p.foto?`<img class="foto-portada" alt="Foto de ${inmuebleEsc(p.datos.titulo)}" loading="lazy" src="data:image/jpeg;base64,${inmuebleEsc(p.foto)}">`:''}
        <span class="etiqueta">${operacionInmueble(p.datos)}</span>
        <h2 style="margin-top:6px">${inmuebleEsc(p.datos.titulo)}</h2>${fichaInmuebleDatos(p.datos)}
        <div class="acciones-inmueble"><a class="link-boton" href="/departamentos?id=${p.id}" data-inmueble="${p.id}">Ver departamento</a></div>
      </article>`).join('');
    porId('resultados').querySelectorAll('[data-inmueble]').forEach(a=>a.onclick=e=>{
      if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
      e.preventDefault();
      verInmueble(Number(a.dataset.inmueble));
    });
    porId('anterior').hidden=pagina===0;
    porId('siguiente').hidden=!d.hay_mas;
  } catch(error) {
    if(peticion===consulta)porId('estado').textContent=error.message;
  }
}

async function verInmueble(id) {
  const peticion=++detalleConsulta;
  porId('contenido').innerHTML='<h2 id="titulo-inmueble">Cargando departamento…</h2>';
  if (!dialogo.open) dialogo.showModal();
  const url=new URL(location.href);
  url.searchParams.set('id',id);
  history.replaceState(null,'',url);
  try {
    const r=await inmuebleRpc('echo_catalogo_inmuebles',{p_id:id});
    if(peticion!==detalleConsulta||!dialogo.open)return;
    const d=r.datos;
    const asunto=encodeURIComponent('Echo · '+operacionInmueble(d)+' · departamento '+id);
    porId('contenido').innerHTML=`<span class="etiqueta">${operacionInmueble(d)}</span><h2 id="titulo-inmueble">${inmuebleEsc(d.titulo)}</h2>
      ${fichaInmuebleDatos(d)}
      <p class="info" style="white-space:pre-wrap">${inmuebleEsc(d.descripcion)}</p>
      ${fotosInmueble(r.fotos)}
      <div class="acciones-inmueble"><a class="link-boton principal" href="mailto:echoadministrationmx@gmail.com?subject=${asunto}">Solicitar información a Echo</a></div>`;
  } catch(error) {
    if(peticion===detalleConsulta&&dialogo.open)porId('contenido').innerHTML=`<h2 id="titulo-inmueble">${inmuebleEsc(error.message)}</h2>`;
  }
}

porId('filtros').onsubmit=e=>{e.preventDefault();pagina=0;cargarCatalogo();};
porId('anterior').onclick=()=>{pagina=Math.max(0,pagina-1);cargarCatalogo();};
porId('siguiente').onclick=()=>{pagina++;cargarCatalogo();};
dialogo.onclose=()=>{
  detalleConsulta++;
  const url=new URL(location.href);
  url.searchParams.delete('id');
  history.replaceState(null,'',url);
  porId('contenido').replaceChildren();
};
const destacado=new URLSearchParams(location.search).get('id');
cargarCatalogo();
if (/^[0-9]{1,14}$/.test(destacado||'')) verInmueble(Number(destacado));
