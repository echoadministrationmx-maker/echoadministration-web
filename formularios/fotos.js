'use strict';

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
