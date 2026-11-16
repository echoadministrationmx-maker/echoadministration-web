'use strict';

const inmuebleEstados = {
  pendiente:'En revisión',publicada:'Publicada',cambios:'Cambios solicitados',
  rechazada:'Rechazada',oculta:'Oculta'
};
const inmueblePlazos = {corto:'Corto plazo',mediano:'Mediano plazo',largo:'Largo plazo'};
const inmuebleApiKey = 'sb_publishable_Gscgjva4RQkFZfwANPpueg_rKfWJ_nU';
const inmuebleEsc = texto => String(texto ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const precioInmueble = d => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:2})
  .format(d.precio) + ' MXN' + (d.periodo?' / '+d.periodo:'');
const operacionInmueble = d => d.operacion==='venta' ? 'Venta' : 'Renta';

async function inmuebleRpc(funcion,argumentos) {
  const respuesta=await fetch('https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/'+funcion,{
    method:'POST',
    headers:{apikey:inmuebleApiKey,'Content-Type':'application/json'},
    body:JSON.stringify(argumentos),
    signal:AbortSignal.timeout(22000)
  });
  if (!respuesta.ok) throw new Error('No se pudo completar la solicitud. Intenta de nuevo.');
  const resultado=await respuesta.json();
  if (!resultado.ok) {
    const error=new Error(resultado.error || 'Revisa los datos e intenta de nuevo.');
    error.sesionVencida=resultado.sesion_vencida;
    throw error;
  }
  return resultado;
}

function fotosInmueble(fotos) {
  return fotos.length ? '<div class="fotos-inmueble">'+fotos.map((f,i) =>
    `<img alt="Foto ${i+1} del departamento" loading="lazy" src="data:image/jpeg;base64,${inmuebleEsc(f)}">`
  ).join('')+'</div>' : '';
}

function fichaInmuebleDatos(d) {
  return `<p class="info">${inmuebleEsc(d.zona)} · ${inmuebleEsc(d.ciudad)}, ${inmuebleEsc(d.region)}</p>
    <p class="info"><strong>${inmuebleEsc(precioInmueble(d))}</strong>${d.plazo?' · '+inmuebleEsc(inmueblePlazos[d.plazo]):''}</p>
    ${d.habitaciones!=null || d.banos!=null ? `<p class="info">${[d.habitaciones==null?'':d.habitaciones+' habitaciones',
      d.banos==null?'':d.banos+' baños'].filter(Boolean).map(inmuebleEsc).join(' · ')}</p>`:''}`;
}
