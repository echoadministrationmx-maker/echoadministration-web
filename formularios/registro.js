'use strict';

const formulario = document.getElementById('registro');
const estado = document.getElementById('estado');
const boton = formulario.querySelector('button[type=submit]');
const esDepartamento = formulario.dataset.tipo === 'departamento';
const clavePublica = 'sb_publishable_Gscgjva4RQkFZfwANPpueg_rKfWJ_nU';

if (esDepartamento) {
  const manzana = new URLSearchParams(location.search).get('manzana');
  if (manzana === 'M60' || manzana === 'M80') formulario.elements.manzana.value = manzana;
}

async function convertirFoto(archivo) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type) || archivo.size > 12 * 1024 * 1024) {
    throw new Error('Selecciona fotos JPG, PNG o WebP de 12 MB o menos.');
  }
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode();
    const escala = Math.min(1, 1200 / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(imagen.width * escala));
    lienzo.height = Math.max(1, Math.round(imagen.height * escala));
    const contexto = lienzo.getContext('2d');
    contexto.fillStyle = '#fff';
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    for (const calidad of [.78, .6, .45, .3]) {
      const data = lienzo.toDataURL('image/jpeg', calidad);
      const prefijo = 'data:image/jpeg;base64,';
      if (data.startsWith(prefijo) && data.length - prefijo.length <= 213336) {
        return data.slice(prefijo.length);
      }
    }
    throw new Error('Una foto es demasiado pesada. Selecciona una imagen más pequeña.');
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('No se pudo abrir una de las fotos.');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

formulario.addEventListener('submit', async evento => {
  evento.preventDefault();
  if (boton.disabled) return;
  const campos = new FormData(formulario);
  const datos = Object.fromEntries(Array.from(campos, ([nombre, valor]) => [nombre, valor.trim()]));
  if (!datos.email && !datos.telefono) {
    estado.textContent = 'Ingresa un correo electrónico o un teléfono.';
    formulario.elements.email.focus();
    return;
  }
  const etiqueta = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Enviando…';
  estado.textContent = '';
  try {
    let argumentos = { p_datos: datos };
    if (esDepartamento) {
      const { manzana, ...depto } = datos;
      depto.plazos = campos.getAll('plazos');
      if (depto.plazos.length === 0) throw new Error('Selecciona al menos un plazo de renta.');
      if (Boolean(depto.precio) !== Boolean(depto.periodo_precio)) {
        throw new Error('Si indicas un precio, también selecciona su periodo.');
      }
      const archivos = Array.from(document.getElementById('fotos').files);
      if (archivos.length > 4) throw new Error('Selecciona como máximo cuatro fotos.');
      depto.fotos = [];
      for (const archivo of archivos) depto.fotos.push(await convertirFoto(archivo));
      argumentos = { p_condominio: manzana, p_datos: depto };
    }
    const funcion = esDepartamento ? 'echo_registrar_departamento' : 'echo_registrar_negocio';
    const respuesta = await fetch('https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/' + funcion, {
      method: 'POST',
      headers: { apikey: clavePublica, 'Content-Type': 'application/json' },
      body: JSON.stringify(argumentos),
      signal: AbortSignal.timeout(20000)
    });
    if (!respuesta.ok) throw new Error('No pudimos guardar el formulario. Intenta de nuevo.');
    const resultado = await respuesta.json();
    if (!resultado.ok) throw new Error(resultado.error || 'Revisa los datos del formulario.');
    formulario.reset();
    formulario.hidden = true;
    const confirmacion = document.getElementById('confirmacion');
    confirmacion.hidden = false;
    confirmacion.focus();
  } catch (error) {
    estado.textContent = error instanceof TypeError || error.name === 'TimeoutError'
      ? 'Revisa tu conexión e intenta de nuevo.' : error.message;
  } finally {
    boton.disabled = false;
    boton.textContent = etiqueta;
  }
});
