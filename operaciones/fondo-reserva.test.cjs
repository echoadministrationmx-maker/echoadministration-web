const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',checked:false,disabled:false,dataset:{},validity:{valid:true},classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll(){return []},reportValidity(){return true}});return nodes.get(id)};const c=vm.createContext({document:{getElementById:node},window:{addEventListener(){},scrollTo(){}},history:{replaceState(){}},location:{hash:''},Intl,Date,setTimeout,clearTimeout,fetch(){throw Error('unexpected network')}});c.globalThis=c;vm.runInContext(fs.readFileSync('operaciones/cobranza-report.js','utf8'),c);for(const match of fs.readFileSync('operaciones/index.html','utf8').matchAll(/<script(?:\s[^>]*)?>(.*?)<\/script>/gs)){if(match[1].trim())vm.runInContext(match[1],c)}vm.runInContext(fs.readFileSync('operaciones/fondo-reserva.js','utf8'),c);return {c,node};}
test('fund search distinguishes registered contributions from missing records',async()=>{const {c,node}=setup();c.fixture={ok:true,residentes:[{id_residente:1,edificio:'A',departamento:'101',nombre_completo:'Ana',pagado:true,monto:1000,folio:1},{id_residente:2,edificio:'B',departamento:'202',nombre_completo:'Beto',pagado:false}]};await vm.runInContext("V='fondo';rpc=async()=>fixture;vFondo()",c);assert.match(node('frRows').innerHTML,/Fondo registrado/);assert.match(node('frRows').innerHTML,/\$1,000/);node('frQ').oninput({target:{value:'Beto'}});assert.match(node('frRows').innerHTML,/Beto/);assert.doesNotMatch(node('frRows').innerHTML,/Ana/);});
test('confirmation records the unit without receipt details and refreshes building collection',async()=>{
 const {c,node}=setup();
 c.fixture={ok:true,residentes:[
  {id_residente:1,edificio:'A',departamento:'101',nombre_completo:'Ana',pagado:false},
  {id_residente:2,edificio:'B',departamento:'202',nombre_completo:'Beto',pagado:true,monto:1000,folio:9}
 ]};
 c.writes=[];
 await vm.runInContext(`V='fondo';rpc=async(fn,args)=>{
  if(fn==='pg_fondo_reserva')return fixture;
  writes.push({fn,args});
  return {ok:true,registrado_at:'2026-11-12T12:00:00Z'};
 };vFondo()`,c);
 assert.match(node('frRanking').innerHTML,/100%[\s\S]*0%/);
 node('frQ').oninput({target:{value:'Ana'}});
 assert.match(node('frRanking').innerHTML,/100%[\s\S]*0%/);
 vm.runInContext('revisarFondo(FONDO.rows[0])',c);
 assert.equal(c.writes.length,0);
 assert.doesNotMatch(node('sheetBox').innerHTML,/comprobante|referencia|<input/i);
 await node('frGuardar').onclick();
 assert.deepEqual(JSON.parse(JSON.stringify(c.writes)),[{
  fn:'pg_marcar_fondo_reserva_pagado',
  args:{p_user:'',p_password:'',p_id_residente:1,p_confirmado:true}
 }]);
 assert.equal((node('frRanking').innerHTML.match(/100%/g)||[]).length,2);
 assert.doesNotMatch(node('frRows').innerHTML,/Ver comprobante/);
 node('frQ').oninput({target:{value:'Beto'}});
 assert.match(node('frRows').innerHTML,/Ver comprobante/);
});
test('ranking uses the share of units paid and separates identical building names across properties',()=>{
 const {c}=setup();
 const rows=[
  {condominio_id:1,edificio:'A',pagado:true},
  {condominio_id:1,edificio:'A',pagado:false},
  {condominio_id:1,edificio:'A',pagado:true},
  {condominio_id:2,edificio:'A',pagado:false},
  {condominio_id:1,edificio:'B',pagado:true}
 ];
 c.rows=rows;
 assert.equal(vm.runInContext("rankingFondo(rows).map(e=>e.edificio+':'+e.pagadas+'/'+e.unidades).join(',')",c),'B:1/1,A:2/3,A:0/1');
});
test('home and login provide visible release marker and direct access',()=>{
 const html=fs.readFileSync('operaciones/index.html','utf8');
 assert.match(html,/Actualizado 12 nov 2026/);
 assert.match(html,/Ver seguimiento anual/);
 assert.match(html,/ir\('fondo'\)/);
 assert.match(html,/location.hash.slice\(1\)/);
 assert.match(html,/fondo-reserva.js\?v=20261112-fondo/);
});
