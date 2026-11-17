import {chromium} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,getDocs,doc,getDoc} from 'firebase/firestore';
import fs from 'fs';import path from 'path';import http from 'http';
const ROOT=path.resolve('..'),FB='node_modules/firebase';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json'};
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(new URL(q.url,'http://x').pathname).slice(1)||'index.html';const fp=path.join(ROOT,f);if(!fs.existsSync(fp)){r.writeHead(404);return r.end()}r.writeHead(200,{'content-type':types[path.extname(fp)]||'text/plain'});r.end(fs.readFileSync(fp))}).listen(5173);
const env=await initializeTestEnvironment({projectId:'clothes-horse',firestore:{rules:fs.readFileSync(ROOT+'/firestore.rules','utf8'),host:'127.0.0.1',port:8080}});
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/clothes-horse/accounts',{method:'DELETE'});
const signUp=async(email,password)=>(await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})).json()).localId;
const ownerUid=await signUp('eric@shop.test','ownerpass1'),staffUid=await signUp('amy@shop.test','staffpass1');
const server=async coll=>{let out;await env.withSecurityRulesDisabled(async c=>{out=(await getDocs(collection(c.firestore(),coll))).docs.map(d=>({id:d.id,...d.data()}))});return out};
const log=[],errs=[];const ok=(name,cond,extra='')=>log.push((cond?'PASS ':'FAIL ')+name+(extra?' :: '+extra:''));
const b=await chromium.launch();
async function newPage(ctx){const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 await ctx.route('https://www.gstatic.com/**',r=>{const f=path.basename(new URL(r.request().url()).pathname);r.fulfill({body:fs.readFileSync(path.join(FB,f)),contentType:'text/javascript'})});return p}
const APP='http://localhost:5173/?emulator=1';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function signIn(p,email,pw){await p.goto(APP);await p.waitForSelector('#login-email',{timeout:15000});await p.fill('#login-email',email);await p.fill('#login-password',pw);await p.click('[data-login]');}
// ---- 1. owner first sign-in becomes manager ----
const ctxA=await b.newContext({viewport:{width:1194,height:834},serviceWorkers:'block'});let pa=await newPage(ctxA);
await signIn(pa,'eric@shop.test','ownerpass1');await pa.waitForFunction(()=>window.cloudPhase==='ready'||typeof cloudPhase!=='undefined'&&cloudPhase==='ready',null,{timeout:20000}).catch(()=>{});
ok('owner app ready',await pa.evaluate(()=>cloudPhase)==='ready',await pa.evaluate(()=>cloudPhase+' '+cloudError));
ok('owner role manager',await pa.evaluate(()=>myRoleName)==='manager');
ok('server roles has owner manager',(await server('roles')).some(r=>r.id===ownerUid&&r.role==='manager'));
// add member + price
await pa.evaluate(()=>{state.members.push({id:'CH-0001',first:'Jane',last:'Doe',phone:'405-555-0101',email:'j@x.com',style:{favorites:[]},plan:'signature',joinDate:'2026-11-01',payment:'Demo: current',status:'Active',photoData:''});typePrices.Dress='30';render()});
await wait(1500);
ok('member on server',(await server('members')).length===1);ok('price on server',(await server('settings')).find(d=>d.id==='prices')?.typePrices?.Dress==='30');
// ---- 2. Wi-Fi drops during checkout, tab closed, reopened online ----
await ctxA.setOffline(true);await wait(300);
await pa.evaluate(()=>{goMember('CH-0001');setView('exchange');newItems.push({type:'Dress',color:'Navy',brand:'',size:'8',signature:false,price:'30'});completeVisit()});
await wait(800);
const local=await pa.evaluate(()=>({visits:state.visits.length,pieces:state.pieces.length,badge:document.getElementById('sync-text')?.textContent||''}));
ok('checkout recorded locally while offline',local.visits===1&&local.pieces===1,JSON.stringify(local));
ok('badge says offline',/Offline/.test(local.badge),local.badge);
ok('server does not have it yet',(await server('visits')).length===0);
await pa.close();await wait(500);
await ctxA.setOffline(false);
pa=await newPage(ctxA);await pa.goto(APP);await pa.waitForSelector('#lock-pin, #lock-password, .sidebar',{timeout:20000});
await wait(3000);
const sv=await server('visits'),sp=await server('pieces');
ok('after reopening online, checkout reached server',sv.length===1&&sp.length===1,`visits ${sv.length} pieces ${sp.length}`);
// ---- 3. a refused save is retried ----
await pa.evaluate(()=>{const real=cloud.write.bind(cloud);let fails=1;cloud.write=async ops=>{if(fails-->0){const e=new Error('simulated');e.code='unavailable';throw e}return real(ops)}});
await pa.evaluate(()=>{appLocked=false;state.notes.push({id:'N-retry',memberId:'CH-0001',date:TODAY(),staff:'Eric',text:'retry test'});render()});
await wait(1500);ok('first attempt failed -> not on server',!(await server('notes')).some(n=>n.id==='N-retry'));
ok('badge shows problem',/problem/.test(await pa.evaluate(()=>document.getElementById('sync-text')?.textContent||'')));
await wait(6500);ok('retried automatically and saved',(await server('notes')).some(n=>n.id==='N-retry'));
ok('badge back to saved',/Saved to cloud/.test(await pa.evaluate(()=>document.getElementById('sync-text')?.textContent||'')));
// ---- 4. staff account: approval, limits, manager login on staff device ----
const ctxB=await b.newContext({viewport:{width:1194,height:834},serviceWorkers:'block'});const pb=await newPage(ctxB);
await signIn(pb,'amy@shop.test','staffpass1');await wait(4000);
ok('new staff sees waiting screen',await pb.evaluate(()=>cloudPhase)==='noaccess');
ok('access request on server',(await server('accessRequests')).some(r=>r.id===staffUid&&r.email==='amy@shop.test'));
await pa.evaluate(()=>{managerUnlocked=true;view='manager';managerTab='team';teamData=null;render()});await wait(2000);
ok('manager sees request',await pa.isVisible(`[data-team-approve="${staffUid}"][data-team-role="staff"]`));
await pa.click(`[data-team-approve="${staffUid}"][data-team-role="staff"]`);await wait(1500);
ok('staff role on server',(await server('roles')).some(r=>r.id===staffUid&&r.role==='staff'));
await pb.click('[data-retry]');await wait(4000);
ok('staff app ready after approval',await pb.evaluate(()=>cloudPhase)==='ready'&&await pb.evaluate(()=>myRoleName)==='staff');
ok('staff sees member',await pb.evaluate(()=>state.members.length)===1);
const denied=await pb.evaluate(async()=>{try{await cloud.write([{type:'set',coll:'settings',id:'prices',data:{typePrices:{Dress:'1'}}}]);return 'allowed'}catch(e){return e.code}});
ok('staff cannot change prices even with devtools',/permission/.test(denied),denied);
const deniedRole=await pb.evaluate(async()=>{try{await cloud.write([{type:'set',coll:'roles',id:cloudUser.uid,data:{role:'manager'}}]);return 'allowed'}catch(e){return e.code}});
ok('staff cannot promote self',/permission/.test(deniedRole),deniedRole);
// manager login on staff device
await pb.evaluate(()=>{appLocked=false;render()});await pb.click('[data-nav="manager"]');await wait(200);
ok('staff device asks for manager email',await pb.isVisible('#mgr-email-input'));
await pb.fill('#mgr-email-input','amy@shop.test');await pb.fill('#mgr-password-input','staffpass1');await pb.click('[data-mgr-unlock]');await wait(1500);
ok('staff creds refused for manager',/not a manager/.test(await pb.textContent('#staff-pin-error')));
await pb.fill('#mgr-email-input','eric@shop.test');await pb.fill('#mgr-password-input','ownerpass1');await pb.click('[data-mgr-unlock]');await wait(2000);
ok('manager opened on staff device',await pb.evaluate(()=>view)==='manager');
await pb.evaluate(()=>{typePrices.Dress='45';render()});await wait(2000);
ok('price changed by manager on staff device',(await server('settings')).find(d=>d.id==='prices')?.typePrices?.Dress==='45');
await pb.click('[data-manager-lock]');await wait(3500);
const after=await pb.evaluate(async()=>{try{await cloud.write([{type:'set',coll:'settings',id:'prices',data:{typePrices:{Dress:'2'}}}]);return 'allowed'}catch(e){return e.code}});
ok('after leaving Manager, staff device is limited again',/permission/.test(after),after);

// ---- 5. owner sets PINs; manager PIN is stored where staff cannot read it ----
await pa.evaluate(()=>{appLocked=false;managerUnlocked=true;view='manager';managerTab='team';render()});await wait(1500);
await pa.click('[data-set-pin="staff"]');await pa.fill('#setpin-password','ownerpass1');await pa.fill('#setpin-new','4826');await pa.fill('#setpin-confirm','4826');await pa.click('[data-pin-save]');await wait(1500);
await pa.click('[data-set-pin="manager"]');await pa.fill('#setpin-password','ownerpass1');await pa.fill('#setpin-new','7391');await pa.fill('#setpin-confirm','7391');await pa.click('[data-pin-save]');await wait(1500);
const mo=await server('managerOnly'),st=await server('settings');
ok('manager PIN saved in manager-only place',mo.some(d=>d.id==='pin'&&d.hash));
ok('staff-readable settings has no manager PIN',!st.some(d=>d.managerPinHash));
const staffReadMgr=await pb.evaluate(async()=>{try{await cloud.read('managerOnly/pin');return 'allowed'}catch(e){return e.code}});
ok('staff cannot read manager PIN',/permission/.test(staffReadMgr),staffReadMgr);
await pa.reload();await pa.waitForSelector('#lock-pin',{timeout:20000});await pa.fill('#lock-pin','4826');await pa.press('#lock-pin','Enter');await wait(500);
await pa.click('[data-nav="manager"]');await wait(300);ok('owner device asks manager PIN',await pa.isVisible('#mgr-pin-input'));
await pa.fill('#mgr-pin-input','4826');await pa.click('[data-mgr-unlock]');await wait(600);ok('staff PIN refused at Manager Login',await pa.evaluate(()=>view)!=='manager');
await pa.fill('#mgr-pin-input','7391');await pa.click('[data-mgr-unlock]');await wait(600);ok('manager PIN opens Manager',await pa.evaluate(()=>view)==='manager');
console.log(log.join('\n'));console.log(log.filter(l=>l.startsWith('FAIL')).length+' failed of '+log.length);console.log('PAGE ERRORS',JSON.stringify(errs.slice(0,5)));
await b.close();srv.close();await env.cleanup();process.exit(0);
