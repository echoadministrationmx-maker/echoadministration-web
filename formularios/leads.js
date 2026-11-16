'use strict';
// Captura de leads de Echo.
// 1) Guarda de dónde llegó la visita (utm_*, referrer y primera página) en localStorage.
// 2) echoLead(tipo, datos) guarda el lead en Supabase antes de abrir WhatsApp, aunque la persona no envíe el mensaje.

(function () {
  const SB = 'https://nwqigjkmlkwyyblgqppm.supabase.co/rest/v1/rpc/echo_registrar_lead';
  const KEY = 'sb_publishable_Gscgjva4RQkFZfwANPpueg_rKfWJ_nU';
  const CLAVE = 'echo_origen_v1';
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch (e) { return null; } }
  function guardar(o) { try { localStorage.setItem(CLAVE, JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ } }

  function refExterno() {
    try {
      if (!document.referrer) return '';
      const r = new URL(document.referrer);
      return r.host === location.host ? '' : r.href.slice(0, 500);
    } catch (e) { return ''; }
  }

  // Registrar la llegada. Si trae UTM o viene de otro sitio, se toma como la fuente más reciente.
  const params = new URLSearchParams(location.search);
  const utm = {};
  UTM.forEach(k => { const v = params.get(k); if (v) utm[k] = v.slice(0, 160); });
  const ref = refExterno();
  const previo = leer();
  if (!previo || Object.keys(utm).length || ref) {
    guardar({
      ...(Object.keys(utm).length ? utm : (previo && !ref ? pick(previo, UTM) : {})),
      referrer: ref || (previo && previo.referrer) || '',
      landing: (location.pathname + location.search).slice(0, 300),
      fecha: new Date().toISOString()
    });
  }

  function pick(o, keys) { const r = {}; keys.forEach(k => { if (o[k]) r[k] = o[k]; }); return r; }

  function origen() {
    const o = leer() || {};
    return {
      ...pick(o, UTM),
      referrer: o.referrer || '',
      landing: o.landing || '',
      pagina: (location.pathname + location.search).slice(0, 300)
    };
  }

  // tipo: comite | inversionista | administrador | convenio | departamento
  window.echoLead = function (tipo, campos) {
    const c = campos || {};
    const cuerpo = {
      tipo,
      nombre: c.nombre || '', telefono: c.telefono || '', email: c.email || '',
      empresa: c.empresa || '', ciudad: c.ciudad || '', mensaje: c.mensaje || '',
      datos: c.datos || {},
      origen: origen()
    };
    try {
      return fetch(SB, {
        method: 'POST',
        keepalive: true, // se envía aunque la página cambie a WhatsApp
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_datos: cuerpo })
      }).then(r => r.ok ? r.json() : null).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  };
})();
