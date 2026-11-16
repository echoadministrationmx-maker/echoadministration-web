'use strict';

const form = document.getElementById('registro');
const estado = document.getElementById('estado');
const boton = form.querySelector('button');
const clavePublica = 'sb_publishable_Gscgjva4RQkFZfwANPpueg_rKfWJ_nU';

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
    enviado.textContent = 'Echo Administración revisará tu registro para incorporarlo al padrón de Manzana 60.';
    enviado.focus();
  } catch(error) {
    estado.textContent = error instanceof TypeError || error.name==='TimeoutError'
      ? 'Revisa tu conexión e intenta de nuevo.' : error.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Enviar registro';
  }
});
