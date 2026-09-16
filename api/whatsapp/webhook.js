const crypto=require('crypto');

function rawBody(req){return new Promise((resolve,reject)=>{const chunks=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)})}
function validSignature(raw,signature){const secret=process.env.META_APP_SECRET;if(!secret||!signature)return false;const expected='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
async function sb(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Supabase env missing');const r=await fetch(base+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error('Supabase '+r.status+': '+await r.text());const text=await r.text();return text?JSON.parse(text):null}
async function resolveResident(phone){const d=await sb('/rest/v1/rpc/whatsapp_resolver_telefono',{method:'POST',body:JSON.stringify({p_phone:phone})});return Number.isFinite(Number(d))?Number(d):null}
async function upsertConversation(phone,idResidente){const q='/rest/v1/whatsapp_conversations?on_conflict=phone';const body={phone,id_residente:idResidente||null,ultimo_mensaje_at:new Date().toISOString(),updated_at:new Date().toISOString()};const rows=await sb(q,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(body)});return rows&&rows[0]}
async function saveMessage(conversation,message){if(!conversation||!message||!message.id)return;const body=message.text&&message.text.body?message.text.body:null;await sb('/rest/v1/whatsapp_messages?on_conflict=meta_message_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({conversation_id:conversation.id,meta_message_id:message.id,direction:'inbound',message_type:message.type||'unknown',body,status:'received',metadata:{timestamp:message.timestamp||null}})})}

module.exports=async function handler(req,res){
 if(req.method==='GET'){
  const mode=req.query&&req.query['hub.mode'],token=req.query&&req.query['hub.verify_token'],challenge=req.query&&req.query['hub.challenge'];
  if(mode==='subscribe'&&token&&token===process.env.WHATSAPP_VERIFY_TOKEN)return res.status(200).send(challenge||'');
  return res.status(403).send('Forbidden');
 }
 if(req.method!=='POST')return res.status(405).send('Method not allowed');
 try{
  const raw=await rawBody(req);
  if(!validSignature(raw,req.headers['x-hub-signature-256']))return res.status(401).send('Invalid signature');
  const payload=JSON.parse(raw.toString('utf8'));
  const changes=(payload.entry||[]).flatMap(e=>e.changes||[]);
  for(const change of changes){
   const value=change.value||{};
   for(const message of value.messages||[]){
    const phone=String(message.from||'').replace(/\D/g,'');
    if(!phone)continue;
    const idResidente=await resolveResident(phone);
    const conversation=await upsertConversation(phone,idResidente);
    await saveMessage(conversation,message);
   }
  }
  return res.status(200).json({ok:true});
 }catch(err){console.error('whatsapp webhook',err);return res.status(500).json({ok:false});}
};
