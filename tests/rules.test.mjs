import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,writeBatch,deleteDoc} from 'firebase/firestore';
import fs from 'fs';
const env=await initializeTestEnvironment({projectId:'clothes-horse',firestore:{rules:fs.readFileSync('../firestore.rules','utf8'),host:'127.0.0.1',port:8080}});
await env.clearFirestore();
const db=(uid,email)=>env.authenticatedContext(uid,{email}).firestore();
const owner=db('owner','eric@x.com'),staff=db('staff1','s@x.com'),stranger=db('rando','r@x.com'),anon=env.unauthenticatedContext().firestore();
const results=[];const t=async(name,p)=>{try{await p;results.push('PASS '+name)}catch(e){results.push('FAIL '+name+' :: '+e.message.split('\n')[0])}};
// before setup: nobody with no role can read records
await t('no-role cannot read members',assertFails(getDoc(doc(stranger,'members/a'))));
await t('anon cannot read',assertFails(getDoc(doc(anon,'members/a'))));
// owner bootstrap
const claim=db=>{const b=writeBatch(db);b.set(doc(db,'meta/owner'),{uid:db===owner?'owner':'rando'});b.set(doc(db,'roles/'+(db===owner?'owner':'rando')),{role:'manager'});return b.commit()};
await t('cannot claim manager without owner record',assertFails(setDoc(doc(owner,'roles/owner'),{role:'manager'})));
await t('owner claims',assertSucceeds(claim(owner)));
await t('second claim blocked',assertFails(claim(stranger)));
await t('stranger cannot self-create role later',assertFails(setDoc(doc(stranger,'roles/rando'),{role:'staff'})));
// access requests
await t('stranger requests access',assertSucceeds(setDoc(doc(stranger,'accessRequests/rando'),{email:'r@x.com',requestedAt:'now'})));
await t('request with fake email blocked',assertFails(setDoc(doc(stranger,'accessRequests/rando'),{email:'boss@x.com',requestedAt:'now'})));
await t('request with extra field blocked',assertFails(setDoc(doc(stranger,'accessRequests/rando'),{email:'r@x.com',requestedAt:'now',role:'manager'})));
await t('manager reads request',assertSucceeds(getDoc(doc(owner,'accessRequests/rando'))));
await t('staff1 cannot read others request',assertFails(getDoc(doc(staff,'accessRequests/rando'))));
// manager approves staff1
await t('manager makes staff',assertSucceeds(setDoc(doc(owner,'roles/staff1'),{role:'staff',email:'s@x.com'})));
await t('staff reads own role',assertSucceeds(getDoc(doc(staff,'roles/staff1'))));
await t('staff cannot read owner role',assertFails(getDoc(doc(staff,'roles/owner'))));
await t('staff cannot promote self',assertFails(setDoc(doc(staff,'roles/staff1'),{role:'manager'})));
// records
await t('staff writes member',assertSucceeds(setDoc(doc(staff,'members/CH-0001'),{first:'A'})));
await t('staff reads member',assertSucceeds(getDoc(doc(staff,'members/CH-0001'))));
await t('manager writes visit',assertSucceeds(setDoc(doc(owner,'visits/V1'),{x:1})));
await t('stranger (no role) cannot read member',assertFails(getDoc(doc(stranger,'members/CH-0001'))));
await t('staff cannot write unknown collection',assertFails(setDoc(doc(staff,'junk/1'),{x:1})));
// settings
await t('staff reads prices',assertSucceeds(getDoc(doc(staff,'settings/prices'))));
await t('staff cannot change prices',assertFails(setDoc(doc(staff,'settings/prices'),{typePrices:{}})));
await t('staff cannot change staff PIN',assertFails(setDoc(doc(staff,'settings/security'),{pinHash:'x'})));
await t('manager changes prices',assertSucceeds(setDoc(doc(owner,'settings/prices'),{typePrices:{}})));
await t('manager sets PIN',assertSucceeds(setDoc(doc(owner,'settings/security'),{pinHash:'x'})));
await t('staff cannot read manager PIN',assertFails(getDoc(doc(staff,'managerOnly/pin'))));
await t('manager writes manager PIN',assertSucceeds(setDoc(doc(owner,'managerOnly/pin'),{hash:'x'})));
await t('manager removes staff',assertSucceeds(deleteDoc(doc(owner,'roles/staff1'))));
await t('removed staff cannot read',assertFails(getDoc(doc(staff,'members/CH-0001'))));
await t('meta/owner cannot be rewritten',assertFails(setDoc(doc(owner,'meta/owner'),{uid:'rando'})));
console.log(results.join('\n'));console.log(results.filter(r=>r.startsWith('FAIL')).length+' failed of '+results.length);
await env.cleanup();process.exit(0);
