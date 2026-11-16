'use strict';

let filtroPublicacion='pendiente';
let busquedaPublicacion='';

async function datosPublicacionesInmuebles(accion) {
  const args={...C};
  if(accion)args.p_accion=accion;
  const d=await rpc('pg_operaciones_publicaciones_inmuebles',args);
  if(!d.ok)throw new Error(d.error);
  return d;
}

async function vPublicacionesInmobiliarias() {
  const d=await datosPublicacionesInmuebles();
  if(V!=='publicaciones-inmuebles')return;
  $('vista').innerHTML=`
    <div class="card">
      <div class="chead"><h2>Publicaciones inmobiliarias</h2>
        <a class="btn gh sm" href="/departamentos" target="_blank" rel="noopener">Ver catálogo público</a>
      </div>
      <p class="sub">Revisa las fichas de renta y venta. Solo se muestran al público las publicaciones aprobadas.</p>
    </div>
    <div class="kpis">
      ${kpiPanel('En revisión',d.publicaciones.filter(p=>p.estado==='pendiente').length)}
      ${kpiPanel('Publicadas',d.publicaciones.filter(p=>p.estado==='publicada').length)}
    </div>
    <div class="card"><div class="grid g2">
      <div><label for="busquedaInmueble">Buscar por título, ciudad o propietario</label><input id="busquedaInmueble" type="search" value="${esc(busquedaPublicacion)}"></div>
      <div><label for="filtroInmueble">Estado</label><select id="filtroInmueble">${opcionesRegistro({'':'Todas',...inmuebleEstados},filtroPublicacion)}</select></div>
    </div></div><div id="listaInmuebles"></div>`;
  function pintar() {
    const consulta=busquedaPublicacion.trim().toLocaleLowerCase('es-MX');
    const coincidencias=d.publicaciones.filter(p=>(!filtroPublicacion||p.estado===filtroPublicacion)&&
      [p.datos.titulo,p.datos.ciudad,p.datos.region,p.propietario,p.usuario].join(' ').toLocaleLowerCase('es-MX').includes(consulta));
    const lista=$('listaInmuebles');
    lista.innerHTML=coincidencias.length?coincidencias.map((p,i)=>`<div class="item">
      <div class="ihead"><b class="iname">${esc(p.datos.titulo)}</b><span class="pill p-blue">${esc(inmuebleEstados[p.estado])}</span></div>
      <p class="sub">${operacionInmueble(p.datos)} · ${esc(p.datos.zona)} · ${esc(p.datos.ciudad)}, ${esc(p.datos.region)}</p>
      <p class="sub">${esc(precioInmueble(p.datos))} · ${esc(p.propietario)}</p>
      <div class="acts"><button class="btn gh sm" data-revisar-inmueble="${i}">Ver ficha</button></div>
    </div>`).join(''):'<div class="empty">No hay fichas que coincidan con la búsqueda.</div>';
    lista.querySelectorAll('[data-revisar-inmueble]').forEach(b=>b.onclick=()=>revisarPublicacionInmueble(coincidencias[Number(b.dataset.revisarInmueble)],b));
  }
  $('busquedaInmueble').oninput=e=>{busquedaPublicacion=e.target.value;pintar();};
  $('filtroInmueble').onchange=e=>{filtroPublicacion=e.target.value;pintar();};
  pintar();
}

async function revisarPublicacionInmueble(p,origen) {
  origen.disabled=true;
  try {
    const detalle=await datosPublicacionesInmuebles({tipo:'detalle',id:p.id});
    if(V!=='publicaciones-inmuebles'||!origen.isConnected)return;
    const r=detalle.registro,d=r.datos;
    const acciones={
      pendiente:{publicada:'Aprobar y publicar',cambios:'Pedir cambios',rechazada:'Rechazar'},
      publicada:{oculta:'Ocultar del catálogo',cambios:'Pedir cambios'}
    }[r.estado] || (r.estado==='oculta' && r.revisado_por?{publicada:'Volver a publicar'}:{});
    sheet(`<h3>${esc(d.titulo)}</h3><p class="sub">${operacionInmueble(d)} · ${esc(inmuebleEstados[r.estado])}</p>
      <div class="dl">
        <div><b>Propietario</b><span>${esc(p.propietario)} · ${esc(p.usuario)}</span></div>
        <div><b>Ubicación</b><span>${esc(d.zona)} · ${esc(d.ciudad)}, ${esc(d.region)}</span></div>
        <div><b>Precio</b><span>${esc(precioInmueble(d))}</span></div>
        <div><b>Plazo</b><span>${esc(inmueblePlazos[d.plazo]||'—')}</span></div>
        <div><b>Habitaciones</b><span>${esc(d.habitaciones??'—')}</span></div>
        <div><b>Baños</b><span>${esc(d.banos??'—')}</span></div>
        <div><b>Dirección privada</b><span>${esc(d.direccion||'—')}</span></div>
        <div><b>Correo</b><span>${esc(d.email||'—')}</span></div>
        <div><b>Teléfono</b><span>${esc(d.telefono||'—')}</span></div>
      </div>
      <p class="sub" style="white-space:pre-wrap;margin-top:10px">${esc(d.descripcion)}</p>
      ${fotosInmueble(detalle.fotos)}
      ${r.nota?`<p class="sub" style="margin-top:10px"><strong>Última nota de Echo</strong><br>${esc(r.nota)}</p>`:''}
      ${r.estado==='publicada'?`<p style="margin-top:10px"><a href="/departamentos?id=${r.id}" target="_blank" rel="noopener">Abrir en el catálogo</a></p>`:''}
      ${Object.keys(acciones).length?`
        <form id="formRevisionInmueble" style="margin-top:13px">
          <label for="accionInmueble">Decisión</label><select id="accionInmueble" required><option value="">Elige una decisión</option>${opcionesRegistro(acciones,'')}</select>
          <label for="notaInmueble" style="margin-top:8px">Nota para el propietario</label><textarea id="notaInmueble" rows="2" maxlength="1000"></textarea>
          <p class="sub">Agrega una nota al pedir cambios o rechazar.</p>
          <p class="sub" id="errorRevisionInmueble" role="status"></p>
          <div class="acts"><button class="btn" type="submit">Guardar decisión</button><button class="btn gh" type="button" onclick="cerrarSheet()">Cerrar</button></div>
        </form>`:'<div class="acts"><button class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>'}`);
    const form=$('formRevisionInmueble');
    if(form)form.onsubmit=async e=>{
      e.preventDefault();
      const estado=$('accionInmueble').value,nota=$('notaInmueble').value.trim();
      const b=form.querySelector('[type=submit]'),error=$('errorRevisionInmueble');
      if (['cambios','rechazada'].includes(estado)&&!nota){error.textContent='Escribe una nota para el propietario.';return;}
      if (estado==='publicada'&&!confirm('¿Aprobar esta ficha y mostrarla en el catálogo público?'))return;
      b.disabled=true;
      try {
        await datosPublicacionesInmuebles({tipo:'revisar',id:r.id,version:r.version,estado,nota});
        if (V!=='publicaciones-inmuebles'||!form.isConnected)return;
        cerrarSheet();
        toast('Decisión guardada','good');
        await vPublicacionesInmobiliarias();
      } catch(e) {error.textContent=e.message;}
      finally {b.disabled=false;}
    };
  } catch(e) {
    if (V==='publicaciones-inmuebles')toast(e.message,'err');
  } finally {origen.disabled=false;}
}
