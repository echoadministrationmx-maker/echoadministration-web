'use strict';

const form = document.getElementById('registro');
const estado = document.getElementById('estado');
const boton = form.querySelector('button');
const clavePublica = 'sb_publishable_Gscgjva4RQkFZfwANPpueg_rKfWJ_nU';

async function cargarDatosPagoM60(){
  try{
    const respuesta=await fetch('https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/pg_informacion_pago_m60',{
      method:'POST',headers:{apikey:clavePublica,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)
    });
    if(!respuesta.ok)throw new Error('No se pudo consultar información de pago.');
    const d=await respuesta.json();
    if(!/^\d{18}$/.test(d.clabe||'')||!d.cuenta_deposito||!d.correo_comprobantes)throw new Error('Datos incompletos.');
    document.getElementById('cuotaPagoM60').textContent=Number(d.cuota_mensual).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
    document.getElementById('bancoPagoM60').textContent=d.banco;
    document.getElementById('clabePagoM60').textContent=d.clabe;
    document.getElementById('cuentaPagoM60').textContent=d.cuenta_deposito;
    const comprobante=document.getElementById('comprobantePagoM60');
    comprobante.textContent=d.correo_comprobantes;comprobante.href='mailto:'+d.correo_comprobantes;
    const correo=document.getElementById('contactoCorreoM60');
    correo.textContent=d.correo_contacto;correo.href='mailto:'+d.correo_contacto;
    const telefono=document.getElementById('contactoTelefonoM60');
    telefono.textContent=d.telefono_contacto;telefono.href='tel:'+d.telefono_contacto.replace(/[^+0-9]/g,'');
    document.getElementById('datosPagoM60').hidden=false;
  }catch(error){document.getElementById('pagoM60Error').hidden=false;}
}
cargarDatosPagoM60();

async function cargarAvisosComunidadM60(){
  try{
    const respuesta=await fetch('https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/pg_avisos_comunidad_m60',{
      method:'POST',headers:{apikey:clavePublica,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)
    });
    if(!respuesta.ok)throw new Error('No se pudieron consultar los avisos.');
    const avisos=await respuesta.json();
    if(!Array.isArray(avisos)||!avisos.length)return;
    const lista=document.getElementById('listaAvisosComunidadM60');
    for(const aviso of avisos){
      const item=document.createElement('article');item.className='aviso-comunidad '+(['alerta','urgente'].includes(aviso.tipo)?aviso.tipo:'info');
      const titulo=document.createElement('h3');titulo.textContent=aviso.titulo;
      const mensaje=document.createElement('p');mensaje.textContent=aviso.mensaje;
      const fecha=document.createElement('small');fecha.textContent=new Date(aviso.fecha).toLocaleDateString('es-MX',{timeZone:'America/Mexico_City',day:'numeric',month:'long',year:'numeric'});
      item.append(titulo,mensaje,fecha);lista.append(item);
    }
    document.getElementById('avisosComunidadM60').hidden=false;
  }catch(error){/* El registro de propietarios permanece disponible. */}
}
cargarAvisosComunidadM60();

form.addEventListener('submit',async evento=>{
  evento.preventDefault();
  if (boton.disabled) return;
  const datos = Object.fromEntries([...new FormData(form)].map(([campo,valor])=>[`p_${campo}`,valor.trim() || null]));
  estado.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Enviando…';
  try {
    const respuesta = await fetch('https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/registrar_propietario_m60',{
      method:'POST',
      headers:{apikey:clavePublica,'Content-Type':'application/json'},
      body:JSON.stringify(datos),
      signal:AbortSignal.timeout(15000)
    });
    if (!respuesta.ok) throw new Error('No se pudo enviar tu registro. Intenta de nuevo.');
    const resultado = await respuesta.json();
    if (!resultado.ok) throw new Error(resultado.error);
    form.reset();
    form.hidden = true;
    document.getElementById('titulo').textContent = 'Registro recibido';
    document.getElementById('registroIntro').hidden = true;
    const enviado = document.getElementById('enviado');
    enviado.hidden = false;
    enviado.textContent = 'Echo Administración revisará tu registro para incorporarlo al padrón de Manzanas 60 y 61.';
    enviado.focus();
  } catch(error) {
    estado.textContent = error instanceof TypeError || error.name==='TimeoutError'
      ? 'Revisa tu conexión e intenta de nuevo.' : error.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Enviar registro';
  }
});
