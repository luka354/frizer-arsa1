const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Frizer Arsa <onboarding@resend.dev>';
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const SITE_URL = (process.env.SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
const json = (status, body) => new Response(JSON.stringify(body), {status, headers});
const cleanPhone = s => String(s || '').replace(/\D/g, '').slice(-10);
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function mapRow(r, full=true){
  const b={id:r.id,date:r.booking_date,time:r.booking_time,status:r.status};
  if(full) Object.assign(b,{name:r.name,phone:r.phone,email:r.email,notes:r.notes,service:r.service,cancelCode:r.cancel_code,cancelToken:r.cancel_token,createdAt:r.created_at});
  return b;
}
function niceDate(v){
  try{return new Intl.DateTimeFormat('sr-Latn-RS',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Belgrade'}).format(new Date(`${v}T12:00:00Z`))}catch{return v}
}
async function sb(path, opts={}){
  if(!SB_URL || !SB_KEY) throw new Error('Baza nije podešena');
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{
    ...opts,
    headers:{apikey:SB_KEY,...(SB_KEY.startsWith('sb_')?{}:{Authorization:`Bearer ${SB_KEY}`}), 'Content-Type':'application/json',Prefer:opts.prefer||'return=representation',...(opts.headers||{})}
  });
  const txt=await r.text();
  let data; try{data=txt?JSON.parse(txt):null}catch{data=txt}
  if(!r.ok) throw new Error(data?.message||data?.hint||`Database error ${r.status}`);
  return data;
}
async function sendEmail(to, subject, html){
  if(!RESEND_KEY || !to) return {ok:false,error:'Email servis nije podešen'};
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:RESEND_FROM,to:[to],subject,html})
  });
  const txt=await r.text(); let data; try{data=txt?JSON.parse(txt):null}catch{data=txt}
  return {ok:r.ok,error:r.ok?'':(data?.message||data?.error||`Resend error ${r.status}`),id:data?.id||''};
}
function card(title,b,extra=''){
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#191919"><h1 style="font-size:30px">${title}</h1><p>Zdravo ${esc(b.name)},</p><div style="padding:18px;background:#f5f1ec;border-radius:12px;line-height:1.7"><b>${esc(b.service)}</b><br>${esc(niceDate(b.booking_date))}<br>${esc(b.booking_time)} – termin od 45 minuta</div><p><b>Frizer Arsa</b><br>Dr Zorana Đinđića 14<br>34000 Kragujevac, Srbija</p>${extra}</div>`;
}
function confirmHtml(b){
  const cancelUrl=`${SITE_URL}/cancel.html?token=${encodeURIComponent(b.cancel_token)}`;
  return card('Tvoj termin kod Frizera Arse je potvrđen',b,`<p>Kod za otkazivanje: <b>${esc(b.cancel_code)}</b></p><p><a href="${cancelUrl}" style="display:inline-block;background:#b98a56;color:#111;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:bold">Otkaži termin</a></p><p style="color:#777">Dobićeš podsetnik dan pre termina.</p>`);
}
function cancelledHtml(b){return card('Termin je otkazan',b,'<p>Termin je otkazan i vreme je ponovo slobodno.</p>')}
function rescheduledHtml(b){const cancelUrl=`${SITE_URL}/cancel.html?token=${encodeURIComponent(b.cancel_token)}`;return card('Tvoj termin je promenjen',b,`<p>Novi datum i vreme su prikazani iznad.</p><p><a href="${cancelUrl}" style="display:inline-block;background:#b98a56;color:#111;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:bold">Otkaži termin</a></p>`) }
function ownerHtml(title,b){return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1>${esc(title)}</h1><p><b>${esc(b.name)}</b><br>${esc(b.phone)}<br>${esc(b.email||'Nema emaila')}</p><p><b>${esc(b.service)}</b><br>${esc(niceDate(b.booking_date))}<br>${esc(b.booking_time)}</p><p>Napomena: ${esc(b.notes||'—')}</p></div>`}
function isAdmin(req){return !!ADMIN_KEY && req.headers.get('x-admin-key')===ADMIN_KEY}
async function activeAt(date,time,idToIgnore=''){
  const rows=await sb(`barber_bookings?booking_date=eq.${encodeURIComponent(date)}&booking_time=eq.${encodeURIComponent(time)}&select=id,status`,{method:'GET'});
  return (rows||[]).some(r=>String(r.id)!==String(idToIgnore)&&!['Cancelled','No Show'].includes(r.status));
}

export default async (req) => {
  try{
    const url=new URL(req.url);
    if(req.method==='GET'){
      if(url.searchParams.get('health')==='1') return json(200,{ok:true,databaseConfigured:!!(SB_URL&&SB_KEY),emailConfigured:!!RESEND_KEY,siteUrlConfigured:!!SITE_URL,adminConfigured:!!ADMIN_KEY,ownerEmailConfigured:!!OWNER_EMAIL,from:RESEND_FROM});
      const admin=url.searchParams.get('admin')==='1';
      if(admin&&!isAdmin(req)) return json(401,{error:'Pogrešna admin lozinka'});
      const select=admin?'*':'id,booking_date,booking_time,status';
      const rows=await sb(`barber_bookings?select=${encodeURIComponent(select)}&order=booking_date.asc,booking_time.asc`,{method:'GET'});
      return json(200,{bookings:(rows||[]).map(r=>mapRow(r,admin))});
    }
    if(req.method!=='POST') return json(405,{error:'Method not allowed'});
    const body=await req.json().catch(()=>({})); const action=body.action;

    if(action==='create'){
      const b=body.booking||{};
      if(!b.name||!b.phone||!b.email||!b.service||!b.date||!b.time) return json(400,{error:'Ime, telefon, email, usluga, datum i vreme su obavezni.'});
      if(await activeAt(b.date,b.time)) return json(409,{error:'Ovaj termin je već zauzet.'});
      const row={name:b.name,phone:b.phone,email:b.email,notes:b.notes||'',service:b.service,booking_date:b.date,booking_time:b.time,status:'Confirmed',cancel_code:String(Math.floor(100000+Math.random()*900000)),cancel_token:crypto.randomUUID()};
      let ins; try{ins=await sb('barber_bookings',{method:'POST',body:JSON.stringify(row)})}catch(e){if(String(e.message).toLowerCase().includes('duplicate')) return json(409,{error:'Ovaj termin je već zauzet.'});throw e}
      const saved=ins[0];
      const emailResult=await sendEmail(saved.email,'Frizer Arsa — termin potvrđen',confirmHtml(saved));
      if(OWNER_EMAIL) await sendEmail(OWNER_EMAIL,'Frizer Arsa — nova rezervacija',ownerHtml('Nova rezervacija',saved));
      return json(201,{booking:mapRow(saved,true),emailSent:emailResult.ok,emailError:emailResult.ok?'':emailResult.error});
    }

    if(action==='cancelByToken'){
      const token=body.token; if(!token) return json(400,{error:'Nedostaje token za otkazivanje.'});
      const rows=await sb(`barber_bookings?cancel_token=eq.${encodeURIComponent(token)}&select=*`,{method:'GET'}); const b=rows?.[0];
      if(!b) return json(404,{error:'Rezervacija nije pronađena.'});
      if(b.status==='Cancelled') return json(200,{booking:mapRow(b,true)});
      const up=await sb(`barber_bookings?id=eq.${b.id}`,{method:'PATCH',body:JSON.stringify({status:'Cancelled'})}); const saved=up[0];
      await sendEmail(saved.email,'Frizer Arsa — termin otkazan',cancelledHtml(saved));
      if(OWNER_EMAIL) await sendEmail(OWNER_EMAIL,'Frizer Arsa — rezervacija otkazana',ownerHtml('Rezervacija otkazana',saved));
      return json(200,{booking:mapRow(saved,true)});
    }

    if(action==='cancelByCode'){
      const code=String(body.code||''),phone=cleanPhone(body.phone); if(!code||!phone) return json(400,{error:'Telefon i kod za otkazivanje su obavezni.'});
      const rows=await sb(`barber_bookings?cancel_code=eq.${encodeURIComponent(code)}&select=*`,{method:'GET'});
      const b=(rows||[]).find(x=>cleanPhone(x.phone)===phone&&x.status!=='Cancelled');
      if(!b) return json(404,{error:'Rezervacija nije pronađena. Proveri telefon i kod.'});
      const up=await sb(`barber_bookings?id=eq.${b.id}`,{method:'PATCH',body:JSON.stringify({status:'Cancelled'})}); const saved=up[0];
      await sendEmail(saved.email,'Frizer Arsa — termin otkazan',cancelledHtml(saved));
      if(OWNER_EMAIL) await sendEmail(OWNER_EMAIL,'Frizer Arsa — rezervacija otkazana',ownerHtml('Rezervacija otkazana',saved));
      return json(200,{booking:mapRow(saved,true)});
    }

    if(['adminCreate','adminUpdate','adminDelete'].includes(action)&&!isAdmin(req)) return json(401,{error:'Pogrešna admin lozinka'});
    if(action==='adminCreate'){
      const b=body.booking||{}; if(!b.name||!b.phone||!b.service||!b.date||!b.time) return json(400,{error:'Ime, telefon, usluga, datum i vreme su obavezni.'});
      if(await activeAt(b.date,b.time)) return json(409,{error:'Ovaj termin je već zauzet.'});
      const row={name:b.name,phone:b.phone,email:b.email||null,notes:b.notes||'',service:b.service,booking_date:b.date,booking_time:b.time,status:b.status||'Confirmed',cancel_code:String(Math.floor(100000+Math.random()*900000)),cancel_token:crypto.randomUUID()};
      const ins=await sb('barber_bookings',{method:'POST',body:JSON.stringify(row)}); const saved=ins[0];
      if(saved.email) await sendEmail(saved.email,'Frizer Arsa — termin potvrđen',confirmHtml(saved));
      return json(201,{booking:mapRow(saved,true)});
    }
    if(action==='adminUpdate'){
      const id=body.id,patch=body.patch||{},dbPatch={};
      if(patch.status)dbPatch.status=patch.status; if(patch.date)dbPatch.booking_date=patch.date; if(patch.time)dbPatch.booking_time=patch.time;
      const rows=await sb(`barber_bookings?id=eq.${encodeURIComponent(id)}&select=*`,{method:'GET'}); const current=rows?.[0]; if(!current) return json(404,{error:'Rezervacija nije pronađena.'});
      const date=patch.date||current.booking_date,time=patch.time||current.booking_time;
      if((patch.date||patch.time)&&await activeAt(date,time,id)) return json(409,{error:'Ovaj termin je već zauzet.'});
      const up=await sb(`barber_bookings?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(dbPatch)}); const saved=up[0];
      if(saved.email){
        if(patch.status==='Cancelled'&&current.status!=='Cancelled') await sendEmail(saved.email,'Frizer Arsa — termin otkazan',cancelledHtml(saved));
        else if(patch.date||patch.time) await sendEmail(saved.email,'Frizer Arsa — termin promenjen',rescheduledHtml(saved));
      }
      return json(200,{booking:mapRow(saved,true)});
    }
    if(action==='adminDelete'){await sb(`barber_bookings?id=eq.${encodeURIComponent(body.id)}`,{method:'DELETE'});return json(200,{ok:true});}
    return json(400,{error:'Nepoznata akcija'});
  }catch(e){return json(500,{error:e.message||'Greška servera'});}
};

export const config = { path:'/api/bookings' };
