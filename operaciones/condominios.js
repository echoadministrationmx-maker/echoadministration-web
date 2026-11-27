'use strict';

const MENU_CONDOMINIO = [
  {g:'Padrón y archivos'},
  {k:'propietarios',t:'Propietarios',i:'🏠'},
  {k:'archivos',t:'Archivos y Excel',i:'📂'}
];
const COLUMNAS_PADRON = [
  ['manzana','Manzana',15,'@'], ['clave','Clave propietario',42,'@'], ['nombre','Nombre completo',35],
  ['edificio','Edificio',15,'@'], ['unidad','Unidad',15,'@'], ['email','Correo',32],
  ['telefono','Teléfono',22,'@'], ['whatsapp','WhatsApp',22,'@']
];
let condominios = [];
let condominioActivo = null;
let puedeCrearCondominio = false;
let promesaExcel;
const filtroHistorialM60 = {anio:2026,edificio:'',busqueda:'',offset:0};

function menuCondominio() {
  const cabecera = puedeCrearCondominio && !manzanaDeRuta
    ? [{k:'portafolio',t:'Vista general',i:'▦'},{k:'leads',t:'Leads',i:'🎯'},{k:'negocios-convenios',t:'Solicitudes de convenios',i:'🤝'},{k:'publicaciones-inmuebles',t:'Publicaciones inmobiliarias',i:'🏠'}] : [];
  if (condominioActivo?.codigo==='M80') return [...cabecera,...MENU_CONDOMINIO,...MENU];
  if (condominioActivo?.codigo==='M60') {
    const equipo = puedeCrearCondominio ? [{k:'equipo-cond',t:'Accesos del equipo',i:'🔑'}] : [];
    return [...cabecera,...VISTAS_M60,{k:'pago-m60',t:'Registrar mensualidad',i:'💳'},
      {k:'historial-m60',t:'Mensualidades y fondo CADU',i:'🗓️'},
      {k:'inventario-rentas',t:'Departamentos en renta',i:'🏠'},...MENU_CONDOMINIO,...equipo];
  }
  return [...cabecera,...MENU_CONDOMINIO];
}

async function vRegistrarPagoM60() {
  const condominio=condominioActivo;
  const padron=await rpc('pg_operaciones_panel_m60',{...C,p_condominio:condominio.id,p_anio:2026});
  if(!padron.ok)throw new Error(padron.error||'No se pudieron cargar las unidades.');
  if(condominio!==condominioActivo||V!=='pago-m60')return;
  const unidades=padron.unidades.sort((a,b)=>`${a.edificio}-${a.numero}`.localeCompare(`${b.edificio}-${b.numero}`,'es',{numeric:true}));
  const hoy=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Mexico_City'});
  $('vista').innerHTML=`<div class="card"><h2>Registrar mensualidad</h2>
    <p class="sub">Manzanas 60 y 61 · Cuota de $500. Registra la fecha real en que se recibió el pago. Los meses ya marcados en el Excel no se capturan dos veces.</p>
    <form id="registrarPagoM60" class="grid g2" style="margin-top:18px">
      <div><label for="pagoM60Unidad">Unidad y titular</label><select id="pagoM60Unidad" required><option value="">Selecciona una unidad</option>
      ${unidades.map(u=>`<option value="${Number(u.id)}">${esc(u.edificio)}-${esc(u.numero)} · ${esc(u.nombre||'Sin titular')}</option>`).join('')}</select></div>
      <div><label for="pagoM60Mes">Mes que se paga</label><input id="pagoM60Mes" type="month" min="2026-10" value="${hoy.slice(0,7)}" required></div>
      <div><label for="pagoM60Fecha">Fecha real del pago</label><input id="pagoM60Fecha" type="date" min="2026-10-01" max="${hoy}" value="${hoy}" required></div>
      <div><label for="pagoM60Destino">Se pagó a</label><select id="pagoM60Destino"><option>Nueva administración</option><option>CADU</option></select></div>
      <div><label for="pagoM60Forma">Forma de pago</label><select id="pagoM60Forma"><option>Transferencia</option><option>Depósito</option><option>Efectivo</option><option>Tarjeta</option><option>Otro</option></select></div>
      <div><label for="pagoM60Referencia">Referencia (opcional)</label><input id="pagoM60Referencia" maxlength="120" placeholder="Folio o referencia bancaria"></div>
      <div class="acts"><button class="btn" id="guardarPagoM60">Guardar pago de $500</button></div>
    </form><p class="sub" id="estadoPagoM60" role="status"></p></div>`;
  $('registrarPagoM60').onsubmit=async e=>{
    e.preventDefault();const boton=$('guardarPagoM60');boton.disabled=true;$('estadoPagoM60').textContent='';
    try{
      const r=await rpc('pg_operaciones_registrar_pago_m60',{
        ...C,p_condominio:condominio.id,p_unidad:Number($('pagoM60Unidad').value),
        p_periodo:$('pagoM60Mes').value+'-01',p_fecha_pago:$('pagoM60Fecha').value,
        p_destino:$('pagoM60Destino').value,p_forma:$('pagoM60Forma').value,
        p_referencia:$('pagoM60Referencia').value.trim()||null
      });
      if(!r.ok)throw new Error(r.error||'No se pudo registrar el pago.');
      filtroHistorialM60.anio=Number($('pagoM60Mes').value.slice(0,4));
      filtroHistorialM60.edificio='';filtroHistorialM60.busqueda='';filtroHistorialM60.offset=0;
      toast('Pago registrado con su fecha real','good');ir('historial-m60');
    }catch(error){$('estadoPagoM60').textContent=error.message;boton.disabled=false;}
  };
}

async function vHistorialM60() {
  const condominio=condominioActivo;
  const f=filtroHistorialM60;
  const d=await rpc('pg_operaciones_historial_m60',{
    ...C,p_condominio:condominio.id,p_anio:f.anio,p_edificio:f.edificio||null,
    p_busqueda:f.busqueda||null,p_offset:f.offset
  });
  if(!d.ok) throw new Error(d.error||'No se pudo consultar el historial.');
  if(condominio!==condominioActivo||V!=='historial-m60') return;
  const rows=d.filas||[];
  $('vista').innerHTML=`<div class="card">
    <div class="chead"><h2>Mensualidades y fondo CADU</h2><button class="btn sm" id="nuevoPagoDesdeHistorial">Registrar pago</button><span class="pill p-blue">${Number(d.total)} registros</span></div>
    <p class="sub">Historial del archivo A11 CONTROL PAGOS Ac.xlsx. Cada $500 corresponde a una mensualidad pagada; el fondo de $1,500 corresponde a CADU. El archivo indica el periodo, pero no la fecha exacta de pago. Desde octubre de 2026 se clasificaron las mensualidades como pagadas a la nueva administración. Puedes corregir el destinatario de cada una.</p>
    <form id="filtrarHistorialM60" class="grid g3" style="margin-top:14px">
      <div><label for="histAnio">Periodo</label><select id="histAnio">
        ${[2026,2025,2024,2023,2022,0].map(y=>`<option value="${y}" ${f.anio===y?'selected':''}>${y||'Fondo CADU'}</option>`).join('')}</select></div>
      <div><label for="histEdificio">Edificio</label><select id="histEdificio"><option value="">Todos</option>
        ${(d.edificios||[]).map(e=>`<option value="${esc(e)}" ${f.edificio===e?'selected':''}>${esc(e)}</option>`).join('')}</select></div>
      <div><label for="histBuscar">Unidad o titular</label><input id="histBuscar" value="${esc(f.busqueda)}" maxlength="80" placeholder="Ej. 60-A-101"></div>
      <div class="acts"><button class="btn sm">Buscar</button></div>
    </form>
  </div><div class="card"><div class="cond-tabla"><table><thead><tr>
    <th>Manzana y unidad</th><th>Titular</th><th>Periodo</th><th>Fecha del pago</th><th>Importe</th><th>Se pagó a</th><th></th>
    </tr></thead><tbody>${rows.map(r=>`<tr>
      <td>${esc(r.edificio)}-${esc(r.unidad)}</td><td>${esc(r.nombre||'—')}</td>
      <td>${r.tipo==='fondo_cadu'?'Fondo CADU':esc(MES[Number(r.periodo.slice(5,7))]+' '+r.periodo.slice(0,4))}</td>
      <td>${r.fecha_pago?fecha(r.fecha_pago):'Sin fecha en Excel'}</td>
      <td>${money(r.monto)}</td><td>${esc(r.destino)}</td>
      <td>${r.tipo==='mensualidad'?`<button type="button" class="btn gh sm editarDestinoM60" data-id="${Number(r.id)}">Editar</button>`:'—'}</td>
    </tr>`).join('')}</tbody></table></div>
    ${rows.length?'':`<p class="sub">No hay pagos registrados para estos filtros.</p>`}
    <div class="acts"><button class="btn gh sm" id="histPrev" ${f.offset===0?'disabled':''}>Anterior</button>
      <span class="sub">${Number(d.total)?f.offset+1:0}–${Math.min(f.offset+rows.length,Number(d.total))} de ${Number(d.total)}</span>
      <button class="btn gh sm" id="histNext" ${f.offset+rows.length>=Number(d.total)?'disabled':''}>Siguiente</button></div>
  </div>`;
  $('nuevoPagoDesdeHistorial').onclick=()=>ir('pago-m60');
  $('filtrarHistorialM60').onsubmit=e=>{
    e.preventDefault();f.anio=Number($('histAnio').value);f.edificio=$('histEdificio').value;
    f.busqueda=$('histBuscar').value.trim();f.offset=0;vHistorialM60().catch(error=>toast(error.message));
  };
  $('histPrev').onclick=()=>{f.offset=Math.max(0,f.offset-100);vHistorialM60().catch(error=>toast(error.message));};
  $('histNext').onclick=()=>{f.offset+=100;vHistorialM60().catch(error=>toast(error.message));};
  $('vista').querySelectorAll('.editarDestinoM60').forEach(b=>b.onclick=()=>{
    const r=rows.find(x=>Number(x.id)===Number(b.dataset.id));
    const conocido=['CADU','Nueva administración'].includes(r.destino);
    sheet(`<h3>Editar destinatario</h3><p class="sub">${esc(r.edificio)}-${esc(r.unidad)} · ${esc(MES[Number(r.periodo.slice(5,7))])} ${esc(r.periodo.slice(0,4))} · ${money(r.monto)}</p>
      <form id="formDestinoM60"><label for="nuevoDestinoM60">¿A quién se pagó esta mensualidad?</label>
      <select id="nuevoDestinoM60"><option value="CADU" ${r.destino==='CADU'?'selected':''}>CADU</option>
        <option value="Nueva administración" ${r.destino==='Nueva administración'?'selected':''}>Nueva administración</option>
        <option value="otro" ${!conocido?'selected':''}>Otro</option></select>
      <input id="otroDestinoM60" maxlength="80" placeholder="Escribe el destinatario" value="${!conocido?esc(r.destino):''}" ${conocido?'hidden':''}>
      <p id="errorDestinoM60" role="status" class="sub"></p><div class="acts"><button class="btn">Guardar</button>
      <button type="button" class="btn gh" onclick="cerrarSheet()">Cancelar</button></div></form>`);
    $('nuevoDestinoM60').onchange=()=>{$('otroDestinoM60').hidden=$('nuevoDestinoM60').value!=='otro';};
    $('formDestinoM60').onsubmit=async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
      const destino=$('nuevoDestinoM60').value==='otro'?$('otroDestinoM60').value.trim():$('nuevoDestinoM60').value;
      try{
        const answer=await rpc('pg_operaciones_editar_destino_m60',{...C,p_condominio:condominio.id,p_id:r.id,p_destino:destino});
        if(!answer.ok)throw new Error(answer.error||'No se pudo guardar.');
        cerrarSheet();await vHistorialM60();toast('Destinatario actualizado','good');
      }catch(error){$('errorDestinoM60').textContent=error.message;button.disabled=false;}
    };
  });
}

function cambiarCondominio(id,destinoSolicitado) {
  if (manzanaDeRuta) return;
  const siguiente = condominios.find(c=>c.id===Number(id));
  if (!siguiente) return;
  if (siguiente.id===condominioActivo?.id) {
    if (destinoSolicitado) ir(destinoSolicitado);
    return;
  }
  condominioActivo = siguiente;
  document.getElementById('cond').textContent = siguiente.nombre;
  document.getElementById('btnNotif').classList.toggle('hide',siguiente.codigo!=='M80');
  cerrarSheet();
  pintarNav();
  const porDefecto = siguiente.codigo==='M80'?'inicio':siguiente.codigo==='M60'?'resumen-local':'propietarios';
  const destino = destinoSolicitado || (V!=='portafolio' && menuCondominio().some(m=>m.k===V) ? V : porDefecto);
  if (siguiente.codigo==='M80') {
    const config = cargarCorte().catch(()=>{});
    cargarNotifs();
    ir(destino);
    config.then(()=>{
      if (condominioActivo===siguiente && V===destino && !MENU_CONDOMINIO.some(m=>m.k===destino)) render();
    });
  } else {
    ir(destino);
  }
}

function pintarSelectorCond() {
  const selector = $('condSelector');
  $('controlCond').classList.toggle('hide',!!manzanaDeRuta);
  selector.replaceChildren(...condominios.map(c=>new Option(c.nombre,c.id)));
  selector.value = String(condominioActivo.id);
  selector.onchange = ()=>cambiarCondominio(selector.value);
  $('btnNuevoCond').classList.toggle('hide',!puedeCrearCondominio || !!manzanaDeRuta);
  $('btnNuevoCond').onclick = abrirNuevoCondominio;
  $('cond').textContent = condominioActivo.nombre;
  $('btnNotif').classList.toggle('hide',condominioActivo.codigo!=='M80');
}

function abrirNuevoCondominio() {
  sheet(`<h3>Agregar condominio</h3><form id="formNuevoCond">
    <div class="grid g2" style="margin-top:12px">
      <div><label for="nuevoCondClave">Código</label><input required id="nuevoCondClave" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9\\-]{0,19}" placeholder="M60"></div>
      <div><label for="nuevoCondNombre">Nombre</label><input required id="nuevoCondNombre" maxlength="100" placeholder="Manzana 60"></div>
    </div>
    <p class="sub" id="nuevoCondEstado" role="status"></p>
    <div class="acts"><button class="btn">Crear condominio</button><button type="button" class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>
  </form>`);
  $('formNuevoCond').onsubmit = async e=>{
    e.preventDefault();
    const formulario = e.currentTarget;
    const estado = $('nuevoCondEstado');
    const boton = formulario.querySelector('button');
    boton.disabled = true;
    try {
      const r = await rpc('pg_operaciones_condominios',{...C,p_nuevo:{
        codigo:$('nuevoCondClave').value,nombre:$('nuevoCondNombre').value
      }});
      if (!r.ok) throw new Error(r.error);
      condominios = r.condominios;
      cambiarCondominio(r.nuevo_id);
      pintarSelectorCond();
      toast('Condominio creado','good');
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  };
}

function agruparPropietarios(filas) {
  const fichas = new Map();
  for (const fila of filas) {
    if (!fichas.has(fila.clave)) fichas.set(fila.clave,{...fila,unidades:[]});
    fichas.get(fila.clave).unidades.push(`${fila.edificio}-${fila.unidad}`);
  }
  return [...fichas.values()];
}

async function datosPadron(id, argumentos = {}) {
  const result = await rpc('pg_operaciones_padron',{...C,p_condominio:id,...argumentos});
  if (!result.ok && !result.problemas && !result.copropietario) throw new Error(result.error);
  return result;
}

function tablaCond(encabezados, filas) {
  return `<div class="cond-tabla"><table>
    <thead><tr>${encabezados.map(t=>`<th scope="col">${esc(t)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f=>`<tr>${f.map(x=>`<td>${esc(x ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

async function vPropietarios() {
  const condominio = condominioActivo;
  const [d,contactos] = await Promise.all([datosPadron(condominio.id),
    condominio.codigo==='M60'?rpc('pg_operaciones_panel_m60',{...C,p_condominio:condominio.id,p_anio:2026}):Promise.resolve(null)]);
  if (condominio!==condominioActivo || V!=='propietarios') return;
  const fichas = agruparPropietarios(d.padron);
  if(contactos?.ok){
    const claves=new Map(contactos.unidades.map(u=>[`${u.edificio}-${u.numero}`,u.clave_cadu]));
    fichas.forEach(f=>f.clave_cadu=claves.get(f.unidades[0])||null);
  }
  const solicitudes = d.solicitudes;

  $('vista').innerHTML = `
    <div class="card">
      <div class="chead"><h2>Padrón de propietarios</h2>
        ${condominio.codigo==='M60' ? '<a class="btn gh sm" href="/registro-propietarios" target="_blank" rel="noopener">Abrir registro de Manzanas 60 y 61</a>' : ''}
        <button class="btn sm" id="propImportar">Importar padrón</button>
      </div>
      <p class="sub">${esc(condominio.nombre)} · ${fichas.length} propietarios · ${d.unidades} unidades activas</p>
    </div>
    ${condominio.codigo==='M60' ? `<div class="card">
      <div class="chead"><h3>Solicitudes de propietarios</h3><span class="pill p-blue">${solicitudes.length} pendientes</span></div>
      ${solicitudes.length ? solicitudes.map((s,i)=>`
        <div class="item">
          <div class="ihead"><b class="iname">${esc(s.nombre)}</b><span class="tag">${esc(s.edificio)}-${esc(s.unidad)}</span></div>
          <p class="sub">${[s.email,s.telefono,fecha(s.creado_at)].filter(Boolean).map(esc).join(' · ')}</p>
          <div class="acts"><button class="btn gh sm" data-solicitud="${i}">Revisar solicitud</button></div>
        </div>`).join('') : '<p class="sub">Desde aquí podrás revisar lo que envíen los propietarios de Manzana 60.</p>'}
    </div>` : ''}
    <div class="card">
      <label for="propBuscar">Buscar por nombre, edificio o unidad</label>
      <input id="propBuscar" type="search">
    </div>
    <div id="propLista"></div>`;

  function pintarFichas() {
    const filtro = $('propBuscar').value.trim().toLocaleLowerCase('es-MX');
    const visibles = fichas.filter(f=>[f.nombre,...f.unidades].join(' ').toLocaleLowerCase('es-MX').includes(filtro));
    $('propLista').innerHTML = visibles.map(f=>`<div class="item">
      <div class="ihead"><span class="iname">${esc(f.nombre||'Propietario sin nombre')}</span><span class="pill p-blue">${f.unidades.length} unidad${f.unidades.length===1?'':'es'}</span></div>
      <p class="sub">${esc(f.unidades.join(' · '))}</p>
      <div class="acts"><button class="btn gh sm" type="button">Ver ficha</button></div>
    </div>`).join('') || '<div class="empty">No hay propietarios para mostrar.</div>';
    $('propLista').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>verFicha(visibles[i],condominio));
  }

  $('propImportar').onclick = ()=>ir('archivos');
  $('propBuscar').oninput = pintarFichas;
  $('vista').querySelectorAll('[data-solicitud]').forEach(b=>{
    b.onclick = ()=>revisarRegistro(solicitudes[Number(b.dataset.solicitud)],condominio,d.padron);
  });
  pintarFichas();
}

function verFicha(ficha,condominio) {
  sheet(`<h3>${esc(ficha.nombre||'Propietario sin nombre')}</h3>
    <p class="sub">${esc(condominio.nombre)} · ${esc(ficha.clave)}</p>
    <div class="dl">
      <div><b>Unidades</b> <span>${esc(ficha.unidades.join(', '))}</span></div>
      ${ficha.clave_cadu?`<div><b>Clave CADU</b> <span>${esc(ficha.clave_cadu)}</span></div>`:''}
      <div><b>Correo</b> <span>${esc(ficha.email||'—')}</span></div>
      <div><b>Teléfono</b> <span>${esc(ficha.telefono||'—')}</span></div>
      <div><b>WhatsApp</b> <span>${esc(ficha.whatsapp||'—')}</span></div>
    </div>
    <div class="acts"><button class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>`);
}

function revisarRegistro(solicitud,condominio,padron) {
  const deUnidad = padron.filter(p=>p.edificio.trim().toUpperCase()===solicitud.edificio && p.unidad.trim().toUpperCase()===solicitud.unidad);
  sheet(`<h3>Revisar solicitud de Manzanas 60 y 61</h3>
    <div class="dl">
      <div><b>Nombre</b> <span>${esc(solicitud.nombre)}</span></div>
      <div><b>Unidad</b> <span>${esc(solicitud.edificio)}-${esc(solicitud.unidad)}</span></div>
      <div><b>Correo</b> <span>${esc(solicitud.email||'—')}</span></div>
      <div><b>Teléfono</b> <span>${esc(solicitud.telefono||'—')}</span></div>
    </div>
    <p class="sub" style="margin-top:12px">${deUnidad.length
      ? `Titularidad registrada en el padrón de esta unidad, ${esc(deUnidad.map(f=>f.nombre).join(' · '))}.`
      : 'Esta unidad todavía no tiene un propietario en el padrón.'}</p>
    <p class="sub" id="registroRevisionEstado" role="status"></p>
    <div class="acts">
      <button class="btn" id="registroAprobar">Confirmar titularidad</button>
      <button class="btn gh" id="registroRechazar">Rechazar</button>
      <button class="btn gh" onclick="cerrarSheet()">Cerrar</button>
    </div>`);

  async function resolver(estado, copropietario = false) {
    const mensaje = $('registroRevisionEstado');
    const botones = [$('registroAprobar'),$('registroRechazar')];
    botones.forEach(b=>b.disabled=true);
    try {
      const r = await datosPadron(condominio.id,{p_revision:{id:solicitud.id,estado,copropietario}});
      if (condominio!==condominioActivo || !$('sheetBox').contains(mensaje)) return;
      if (r.copropietario) {
        mensaje.textContent = r.error;
        botones[0].textContent = 'Confirmar copropiedad';
        botones[0].onclick = ()=>resolver('aprobada',true);
        return;
      }
      cerrarSheet();
      toast(estado==='aprobada'?'Titularidad registrada':'Solicitud rechazada','good');
      await vPropietarios();
    } catch(error) {
      mensaje.textContent = error.message;
    } finally {
      botones.forEach(b=>b.disabled=false);
    }
  }

  $('registroAprobar').onclick = ()=>resolver('aprobada');
  $('registroRechazar').onclick = ()=>resolver('rechazada');
}

function excelCondominio() {
  if (!promesaExcel) {
    promesaExcel = new Promise((resolve,reject)=>{
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
      script.crossOrigin = 'anonymous';
      script.onload = ()=>resolve(window.ExcelJS);
      script.onerror = ()=>{
        script.remove();
        promesaExcel = null;
        reject(new Error('No se pudo cargar Excel. Intenta de nuevo.'));
      };
      document.head.append(script);
    });
  }
  return promesaExcel;
}

function hojaExcel(libro,nombre,columnas,filas) {
  const hoja = libro.addWorksheet(nombre,{views:[{state:'frozen',ySplit:1,showGridLines:false}]});
  hoja.columns = columnas.map(([key,header,width,format])=>({key,header,width,
    style:format?{numFmt:format}:{}}));
  hoja.addRows(filas);
  hoja.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
  hoja.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF1847CC'}};
  hoja.autoFilter = {from:{row:1,column:1},to:{row:1,column:columnas.length}};
  return hoja;
}

async function descargarXlsx(libro,nombre) {
  const bytes = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = nombre;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function descargarPlantilla(condominio) {
  const Excel = await excelCondominio();
  const libro = new Excel.Workbook();
  hojaExcel(libro,'Propietarios',COLUMNAS_PADRON,[{manzana:condominio.codigo}]);
  const guia = libro.addWorksheet('Instrucciones');
  guia.getColumn(1).width = 88;
  guia.addRows([
    ['Padrón de propietarios · Echo'],
    [condominio.codigo==='M60'?'Escribe M60 o M61 en cada fila, según la manzana de la unidad.':'Escribe '+condominio.codigo+' en la columna Manzana de cada fila.'],
    ['Completa la clave del propietario, el nombre, el edificio y la unidad.'],
    ['Usa una clave estable, como PROP-001. Conserva esa clave si el propietario tiene varias unidades.'],
    ['Si ya existe una ficha, copia su clave y la unidad del Excel de Operaciones.'],
    ['Correo, teléfono y WhatsApp son opcionales. Las celdas vacías conservan los datos existentes.'],
    ['Puedes usar hasta 2,000 filas. Guarda el archivo como .xlsx para subirlo.']
  ]);
  guia.getRow(1).font = {bold:true};
  await descargarXlsx(libro,`Echo_Plantilla_Propietarios_${condominio.codigo}.xlsx`);
}

function datosHojaPadron(hoja,condominio) {
  const encabezados = Object.create(null);
  const normalizar = texto=>texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  hoja.getRow(1).eachCell((celda,posicion)=>{encabezados[normalizar(celda.text)]=posicion;});
  const columnas = Object.fromEntries(COLUMNAS_PADRON.map(([clave,titulo])=>[clave,encabezados[normalizar(titulo)]]));
  if (['manzana','clave','nombre','edificio','unidad'].some(k=>!columnas[k])) {
    throw new Error('Usa los encabezados de la plantilla en la hoja Propietarios.');
  }
  if (hoja.rowCount>2001) throw new Error('Cada archivo admite hasta 2,000 filas de propietarios.');
  const datos = [];
  hoja.eachRow((fila,numero)=>{
    if (numero===1) return;
    const resultado = {};
    for (const [campo,indice] of Object.entries(columnas)) {
      if (!indice) continue;
      const celda = fila.getCell(indice);
      if (celda.value != null && !['string','number'].includes(typeof celda.value)) {
        const texto = celda.value.richText?.map(t=>t.text).join('') ??
          (celda.value.hyperlink ? celda.value.text : null);
        if (typeof texto !== 'string') throw new Error(`Fila ${numero}. Usa texto o números simples.`);
        resultado[campo] = texto.trim();
      } else {
        resultado[campo] = celda.text.trim();
      }
    }
    if (!Object.entries(resultado).some(([campo,valor])=>campo!=='manzana' && valor)) return;
    resultado.manzana = resultado.manzana.toUpperCase();
    const manzanaArchivo=resultado.manzana;
    if (condominio.codigo==='M60' ? !['M60','M61'].includes(manzanaArchivo) : manzanaArchivo!==condominio.codigo)
      throw new Error(`Fila ${numero}. Revisa la manzana seleccionada.`);
    if (['clave','nombre','edificio','unidad'].some(k=>!resultado[k])) {
      throw new Error(`Fila ${numero}. Completa la clave, el nombre, el edificio y la unidad.`);
    }
    for (const campo of ['clave','edificio','unidad']) resultado[campo]=resultado[campo].toUpperCase();
    if(condominio.codigo==='M60') {
      const prefijo=manzanaArchivo.slice(1)+'-';
      if(/^\d{2}-/.test(resultado.edificio) && !resultado.edificio.startsWith(prefijo))
        throw new Error(`Fila ${numero}. El edificio no coincide con ${manzanaArchivo}.`);
      if(!resultado.edificio.startsWith(prefijo)) resultado.edificio=prefijo+resultado.edificio;
      if(/^\d{5,12}$/.test(resultado.clave)) {
        resultado.nombre=resultado.nombre.replace(/\b[12]\b/g,'').replace(/\s+/g,' ').trim();
        resultado.clave='M'+resultado.edificio+'-'+resultado.unidad;
      }
      resultado.manzana=condominio.codigo;
    }
    resultado.fila = numero;
    datos.push(resultado);
  });
  if (!datos.length) throw new Error('El archivo todavía no tiene propietarios.');
  return datos;
}

async function leerPadron(archivo,condominio) {
  if (!/\.xlsx$/i.test(archivo.name) || archivo.size>3*1024*1024) {
    throw new Error('Selecciona un archivo .xlsx de 3 MB o menos.');
  }
  const Excel = await excelCondominio();
  const bytes = await archivo.arrayBuffer();
  const libro = new Excel.Workbook();
  try { await libro.xlsx.load(bytes); }
  catch { throw new Error('No se pudo abrir el archivo. Guárdalo de nuevo como .xlsx.'); }
  const hoja = libro.getWorksheet('Propietarios');
  if (!hoja) throw new Error('Falta la hoja Propietarios de la plantilla.');
  const filas = datosHojaPadron(hoja,condominio);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  const huella = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return {nombre:archivo.name,huella,filas};
}

function revisarArchivo(carga,condominio) {
  const resumen = [`Archivo ${carga.nombre}`,`${carga.filas.length} filas para ${condominio.nombre}`];
  sheet(`<h3>Confirmar importación</h3><p class="sub">${resumen.map(esc).join(' · ')}</p>
    ${tablaCond(['Fila','Clave','Nombre','Unidad'],carga.filas.slice(0,8).map(f=>[f.fila,f.clave,f.nombre,`${f.edificio}-${f.unidad}`]))}
    ${carga.filas.length>8?'<p class="sub">Vista previa de las primeras 8 filas.</p>':''}
    <p id="importarEstado" class="sub" role="status"></p>
    <div class="acts"><button class="btn" id="confirmarPadron">Importar a ${esc(condominio.nombre)}</button>
      <button class="btn gh" onclick="cerrarSheet()">Cerrar</button></div>`);
  $('confirmarPadron').onclick = async e=>{
    const boton = e.currentTarget;
    const estado = $('importarEstado');
    boton.disabled = true;
    try {
      const r = await datosPadron(condominio.id,{p_archivo:carga});
      if (!r.ok) {
        const problemas = r.problemas.slice(0,10).map(p=>`Fila ${carga.filas[p.fila-1].fila}. ${p.mensaje}`);
        estado.textContent = [r.error,...problemas].join(' ');
        return;
      }
      if (condominio!==condominioActivo || !$('sheetBox').contains(estado)) return;
      cerrarSheet();
      toast(`${carga.filas.length} filas importadas a ${condominio.nombre}`,'good');
      if (V==='archivos') await vArchivos();
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  };
}

function libroResumen(Excel,condominio,padron,inventario) {
  const libro = new Excel.Workbook();
  const {archivos, mensual, cargas, fecha} = inventario;
  const moneda = '"$"#,##0.00';
  hojaExcel(libro,'Resumen',[['dato','Indicador',38],['resultado','Resultado',32]],[
    {dato:'Condominio',resultado:condominio.nombre},
    {dato:'Fecha de descarga',resultado:fecha},
    {dato:'Unidades activas',resultado:padron.unidades},
    {dato:'Propietarios',resultado:new Set(padron.padron.map(p=>p.clave)).size},
    ...['Documento','Comprobante de pago','Estado sin adeudo','Recibo de servicio'].map(tipo=>({
      dato:tipo,resultado:archivos.filter(a=>a.tipo===tipo).length
    })),
    {dato:'Cargas de padrón',resultado:cargas.length}
  ]);
  hojaExcel(libro,'Archivos',[
    ['tipo','Tipo',24],['folio','Folio',15],['fecha','Fecha registrada',20],['concepto','Concepto',48],
    ['categoria','Categoría',18],['unidad','Unidad',16],['estado','Estado',18],
    ['monto','Monto MXN',18,moneda],['referencia','Referencia',40]
  ],archivos);
  hojaExcel(libro,'Pagos por periodo',[
    ['periodo','Periodo de la cuota',23],['registros','Registros',15],['pagados','Pagados',14],
    ['pendientes','Pendientes',15],['total_pagado','Monto pagado MXN',25,moneda],
    ['total_pendiente','Monto pendiente MXN',25,moneda]
  ],mensual.map(r=>({...r,periodo:r.periodo||'Sin periodo'})));
  hojaExcel(libro,'Propietarios',COLUMNAS_PADRON,padron.padron.map(p=>({...p,manzana:condominio.codigo})));
  hojaExcel(libro,'Importaciones',[
    ['folio','Folio',12],['fecha','Fecha local',22],['archivo','Archivo',40],
    ['filas','Filas',12],['registrado_por','Registrado por',24]
  ],cargas);
  return libro;
}

async function vArchivos() {
  const condominio = condominioActivo;
  const padron = await datosPadron(condominio.id);
  if (condominio!==condominioActivo || V!=='archivos') return;
  $('vista').innerHTML = `
    <div class="card">
      <div class="chead"><h2>Archivos y Excel</h2><button class="btn sm" id="descargarResumenCond">Descargar resumen Excel</button></div>
      <p class="sub">${esc(condominio.nombre)} · Documentos, comprobantes, estados sin adeudo, pagos por periodo y padrón.</p>
      <p class="sub" id="descargaCondEstado" role="status"></p>
    </div>
    <div class="card">
      <div class="chead"><h3>Importar padrón</h3><button class="btn gh sm" id="descargarPlantillaCond">Descargar plantilla</button></div>
      <p class="sub" style="margin:-3px 0 12px">Completa clave de propietario, nombre, edificio y unidad en la plantilla. Revisa el archivo y confirma la carga para crear o actualizar las fichas del padrón.</p>
      <label for="elegirPadron">Archivo de ${esc(condominio.nombre)} (.xlsx)</label>
      <input id="elegirPadron" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      <div class="acts"><button class="btn sm" id="revisarPadron" disabled>Revisar archivo</button></div>
      <p class="sub" id="padronArchivoEstado" role="status"></p>
    </div>
    <div class="card"><h3>Cargas recientes</h3>
      ${padron.cargas.length ? tablaCond(['Archivo','Fecha de carga','Filas','Registrado por'],
        padron.cargas.map(c=>[c.archivo,fecha(c.creado_at),c.filas,c.registrado_por]))
        : '<p class="sub">Aquí aparecerán las importaciones completadas.</p>'}
    </div>`;
  const originales = document.createElement('div');
  originales.className='card';
  originales.innerHTML='<h3>Guardar archivos originales</h3><p class="sub">Cualquier formato, hasta 10 MiB por archivo. No modifica el padrón.</p><input id="originalesInput" type="file" multiple><div class="acts"><button class="btn" id="originalesGuardar">Guardar archivos</button></div><p id="originalesEstado" role="status"></p><div id="originalesLista"></div>';
  $('vista').prepend(originales);
  const originalRpc=async (accion,extra={})=>{
    const d=await rpc('pg_operaciones_originales',{...C,p_condominio:condominio.id,p_accion:accion,...extra});
    if(!d.ok) throw new Error(d.error||'No se pudo completar la operación');
    return d;
  };
  const mensajeOriginal=$('originalesEstado'), listaOriginal=$('originalesLista'), botonOriginal=$('originalesGuardar'), inputOriginal=$('originalesInput');
  async function listarOriginales(){
    const d=await originalRpc('listar');
    listaOriginal.replaceChildren();
    for(const f of d.archivos){
      const fila=document.createElement('div'), boton=document.createElement('button');
      fila.className='acts';
      fila.append(document.createTextNode(f.nombre+' · '+new Date(f.fecha).toLocaleString()+' · '+f.bytes+' bytes '));
      boton.className='btn gh sm';boton.textContent='Descargar';
      boton.onclick=async()=>{try{
        const x=await originalRpc('descargar',{p_id:f.id});
        const bytes=Uint8Array.from(atob(x.contenido),c=>c.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
        const a=document.createElement('a');a.href=url;a.download=x.nombre;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(e){mensajeOriginal.textContent=e.message;}};
      fila.append(boton);listaOriginal.append(fila);
    }
  }
  botonOriginal.onclick=async()=>{
    botonOriginal.disabled=true;let guardados=0;
    try{
      for(const f of Array.from(inputOriginal.files)){
        if(f.size>10485760) throw new Error(f.name+': supera 10 MiB');
        const contenido=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer '+f.name));reader.readAsDataURL(f);});
        await originalRpc('guardar',{p_nombre:f.name,p_contenido:contenido});guardados++;
      }
      inputOriginal.value='';mensajeOriginal.textContent=guardados+' archivo(s) guardado(s).';
    }catch(e){mensajeOriginal.textContent=guardados+' guardado(s). '+e.message;}
    finally{botonOriginal.disabled=false;try{await listarOriginales();}catch(e){mensajeOriginal.textContent+=' '+e.message;}}
  };
  listarOriginales().catch(e=>{mensajeOriginal.textContent=e.message;});
  const archivo = $('elegirPadron');
  const revisar = $('revisarPadron');
  const estado = $('padronArchivoEstado');
  const estadoDescarga = $('descargaCondEstado');
  archivo.onchange = ()=>{revisar.disabled=!archivo.files.length;estado.textContent='';};

  function accion(boton,mensaje,tarea) {
    boton.onclick = async ()=>{
      boton.disabled = true;
      mensaje.textContent = '';
      try { await tarea(); }
      catch (error) { mensaje.textContent = error.message; }
      finally { boton.disabled = false; }
    };
  }

  accion(revisar,estado,async ()=>{
    const seleccionado = archivo.files[0];
    if (!seleccionado) return;
    const carga = await leerPadron(seleccionado,condominio);
    if (condominio===condominioActivo && V==='archivos' && seleccionado===archivo.files[0]) {
      revisarArchivo(carga,condominio);
    }
  });
  accion($('descargarPlantillaCond'),estado,()=>descargarPlantilla(condominio));
  accion($('descargarResumenCond'),estadoDescarga,async ()=>{
    const [Excel,d] = await Promise.all([excelCondominio(),rpc('pg_operaciones_archivos',{...C,p_condominio:condominio.id})]);
    if (!d.ok) throw new Error(d.error);
    if (condominio!==condominioActivo) return;
    await descargarXlsx(libroResumen(Excel,condominio,padron,d),`Echo_Resumen_${condominio.codigo}_${d.fecha}.xlsx`);
  });
}
