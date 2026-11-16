'use strict';

const buscar = id=>document.getElementById(id);
const acceso = buscar('acceso');
const panel = buscar('panel');
const cuenta = buscar('cuenta');
const formulario = buscar('publicacion');
let modo='crear';
let token=sessionStorage.getItem('echo_inmuebles_token') || '';
let actual=null;

function cambiarModo(tipo) {
  modo=tipo;
  const nueva=modo==='crear';
  buscar('campo-nombre').hidden=!nueva;
  cuenta.elements.nombre.required=nueva;
  cuenta.elements.clave.autocomplete=nueva?'new-password':'current-password';
  buscar('cuenta-titulo').textContent=nueva?'Crea tu acceso':'Inicia sesión';
  buscar('cuenta-enviar').textContent=nueva?'Crear acceso':'Entrar';
  buscar('crear-tab').classList.toggle('secundario',!nueva);
  buscar('entrar-tab').classList.toggle('secundario',nueva);
  buscar('error-cuenta').textContent='';
}

function cerrarAccesoLocal() {
  token='';
  sessionStorage.removeItem('echo_inmuebles_token');
  panel.hidden=true;
  buscar('lista').replaceChildren();
  formulario.reset();
  formulario.hidden=true;
  actual=null;
  acceso.hidden=false;
  cambiarModo('entrar');
}

async function misPublicaciones(accion) {
  try {
    const args={p_token:token};
    if (accion) args.p_accion=accion;
    return await inmuebleRpc('echo_mis_inmuebles',args);
  } catch(error) {
    if (error.sesionVencida) {
      cerrarAccesoLocal();
      buscar('error-cuenta').textContent='Tu sesión venció. Inicia sesión para continuar.';
    }
    throw error;
  }
}

async function recargarPublicaciones() {
  const r=await misPublicaciones();
  acceso.hidden=true;
  panel.hidden=false;
  buscar('saludo').textContent='Mis publicaciones · '+r.nombre;
  buscar('lista').innerHTML=r.publicaciones.length ? r.publicaciones.map((p,i)=>`
      <article class="ficha"><div class="barra" style="margin-bottom:0">
        <h2>${inmuebleEsc(p.datos.titulo)}</h2><span class="etiqueta">${inmuebleEsc(inmuebleEstados[p.estado])}</span>
      </div>
      <p class="info">${operacionInmueble(p.datos)}</p>${fichaInmuebleDatos(p.datos)}
      ${p.nota?`<p class="info"><strong>Mensaje de Echo</strong><br>${inmuebleEsc(p.nota)}</p>`:''}
      <div class="acciones-inmueble">
        <button class="secundario" type="button" data-editar="${i}">Editar ficha</button>
        ${['publicada','pendiente'].includes(p.estado)?`<button class="secundario" type="button" data-ocultar="${i}">${p.estado==='publicada'?'Retirar del catálogo':'Retirar de revisión'}</button>`:''}
        ${p.estado==='publicada'?`<a class="link-boton" href="/departamentos?id=${p.id}">Ver en catálogo</a>`:''}
      </div></article>`).join('') : '<div class="ficha"><p>Todavía puedes agregar tu primer departamento.</p></div>';
  const lista=buscar('lista');
  lista.querySelectorAll('[data-editar]').forEach(b=>{
    b.onclick=async()=>{
      b.disabled=true;
      buscar('estado-panel').textContent='';
      try {
        const d=await misPublicaciones({tipo:'detalle',id:r.publicaciones[Number(b.dataset.editar)].id});
        mostrarFormulario(d.registro,d.fotos);
      } catch(error) {
        buscar('estado-panel').textContent=error.message;
      } finally { b.disabled=false; }
    };
  });
  lista.querySelectorAll('[data-ocultar]').forEach(b=>{
    b.onclick=async()=>{
      if (!confirm('¿Retirar esta ficha?')) return;
      const p=r.publicaciones[Number(b.dataset.ocultar)];
      b.disabled=true;
      try {
        await misPublicaciones({tipo:'ocultar',id:p.id,version:p.version});
        if(actual?.id===p.id)ocultarFormulario();
        await recargarPublicaciones();
        buscar('estado-panel').textContent='Ficha retirada.';
      } catch(error) {
        buscar('estado-panel').textContent=error.message;
      } finally { b.disabled=false; }
    };
  });
}

function actualizarTipoInmueble() {
  const renta=formulario.elements.operacion.value==='renta';
  buscar('campo-plazo').hidden=!renta;
  buscar('campo-periodo').hidden=!renta;
}

function mostrarFormulario(registro=null,fotos=[]) {
  actual=registro;
  formulario.reset();
  if (registro) {
    for (const [campo,valor] of Object.entries(registro.datos)) {
      if (formulario.elements[campo] && valor!=null) formulario.elements[campo].value=valor;
    }
  }
  actualizarTipoInmueble();
  buscar('titulo-form').textContent=registro?'Editar departamento':'Nuevo departamento';
  buscar('error-publicacion').textContent='';
  buscar('fotos-actuales').innerHTML=fotos.length
    ? '<p class="ayuda">Si eliges fotos nuevas, reemplazarán las actuales.</p>'+fotosInmueble(fotos)
    : '';
  formulario.hidden=false;
  formulario.scrollIntoView({block:'start'});
  formulario.elements.titulo.focus();
}

function ocultarFormulario() {
  actual=null;
  formulario.reset();
  formulario.hidden=true;
  buscar('fotos-actuales').replaceChildren();
}

buscar('crear-tab').onclick=()=>cambiarModo('crear');
buscar('entrar-tab').onclick=()=>cambiarModo('entrar');
buscar('nueva').onclick=()=>mostrarFormulario();
buscar('cancelar').onclick=()=>{ocultarFormulario();buscar('nueva').focus();};
buscar('operacion').onchange=actualizarTipoInmueble;

buscar('salir').onclick=async()=>{
  const anterior=token;
  cerrarAccesoLocal();
  try {
    await inmuebleRpc('echo_mis_inmuebles',{p_token:anterior,p_accion:{tipo:'salir'}});
  } catch {}
};

cuenta.onsubmit=async e=>{
  e.preventDefault();
  const b=buscar('cuenta-enviar');
  if(b.disabled)return;
  const estado=buscar('error-cuenta');
  b.disabled=true;
  estado.textContent='';
  try {
    const d=await inmuebleRpc('echo_cuenta_inmuebles',{p_accion:modo,p_usuario:cuenta.elements.usuario.value,
      p_clave:cuenta.elements.clave.value,p_nombre:cuenta.elements.nombre.value});
    token=d.token;
    sessionStorage.setItem('echo_inmuebles_token',token);
    cuenta.reset();
    await recargarPublicaciones();
  } catch(error) {
    estado.textContent=error.message;
  } finally { b.disabled=false; }
};

formulario.onsubmit=async e=>{
  e.preventDefault();
  const b=formulario.querySelector('[type=submit]');
  if(b.disabled)return;
  const estado=buscar('error-publicacion');
  const datos=Object.fromEntries([...new FormData(formulario)].map(([k,v])=>[k,v.trim()]));
  if (!datos.email&&!datos.telefono) {estado.textContent='Agrega un correo o teléfono de contacto.';return;}
  const archivos=[...buscar('fotos').files];
  if (archivos.length>4) {estado.textContent='Puedes subir un máximo de cuatro fotos.';return;}
  b.disabled=true;
  b.textContent='Guardando…';
  estado.textContent='';
  try {
    const a={tipo:'guardar',datos};
    if(actual){a.id=actual.id;a.version=actual.version;}
    if(archivos.length){
      a.fotos=[];
      for(const archivo of archivos)a.fotos.push(await convertirFoto(archivo));
    }
    await misPublicaciones(a);
    ocultarFormulario();
    await recargarPublicaciones();
    buscar('estado-panel').textContent='Ficha enviada a revisión de Echo.';
  } catch(error) {
    estado.textContent=error.message;
  } finally {
    b.disabled=false;
    b.textContent='Enviar a revisión';
  }
};

if (token) recargarPublicaciones().catch(error=>{
  if (!error.sesionVencida) buscar('error-cuenta').textContent=error.message;
});
