// Connects the app to Firebase: staff sign-in (Firebase Auth) and cloud records (Firestore).
// app.js talks to this file only through window.cloud.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, connectAuthEmulator, inMemoryPersistence, setPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, writeBatch, getDocsFromServer, getDocs, getDoc, getDocFromServer, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// Local testing only: on this computer, ?emulator=1 talks to the Firebase emulators instead of the real project.
const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// The offline cache keeps records on the device so the app still opens and saves without internet;
// changes made offline upload automatically when the connection returns.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (useEmulator) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080); }

// A second, temporary sign-in used when a manager unlocks Manager Login on a device signed in with a staff account.
// Manager-only saves (prices, PINs, staff access) then go through the manager's own account, so the database rules apply to them.
let mgr = null; // { auth, db, uid }
const MANAGER_COLLS = ['settings', 'managerOnly', 'roles', 'accessRequests'];

const friendlyAuthError = err => {
  const code = (err && err.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) return 'That email and password do not match a staff account.';
  if (code.includes('too-many-requests')) return 'Too many tries. Please wait a few minutes and try again.';
  if (code.includes('network')) return 'No internet connection. Connect to Wi-Fi and try again.';
  if (code.includes('user-disabled')) return 'This staff account has been turned off.';
  return 'Sign-in did not work. Please try again.';
};
const readDoc = async (d, path) => { const ref = doc(d, path); try { return await getDocFromServer(ref); } catch (e) { if (String(e.code).includes('permission')) throw e; return await getDoc(ref); } };
const commitOps = async (d, ops) => {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(d);
    ops.slice(i, i + 450).forEach(op => { const ref = doc(d, op.coll, op.id); if (op.type === 'delete') batch.delete(ref); else batch.set(ref, op.data); });
    await batch.commit();
  }
};

window.cloud = {
  enabled: true,
  emulator: useEmulator,
  onUser(cb) { return onAuthStateChanged(auth, user => cb(user ? { uid: user.uid, email: user.email } : null)); },
  async signIn(email, password) { try { await signInWithEmailAndPassword(auth, email, password); return ''; } catch (e) { return friendlyAuthError(e); } },
  async resetPassword(email) { try { await sendPasswordResetEmail(auth, email); return ''; } catch (e) { return friendlyAuthError(e); } },
  signOut() { this.endManager(); return signOut(auth); },
  // Checks the signed-in person's password again (used for the staff PIN). Needs internet.
  async verifyPassword(password) {
    const user = auth.currentUser;
    if (!user || !password) return 'Enter your Clothes Horse password.';
    try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); return ''; }
    catch (e) { const code = (e && e.code) || ''; if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'That password is not right. Please try again.'; return friendlyAuthError(e); }
  },
  // This account's role ('staff' | 'manager' | null). Throws when offline with nothing cached.
  async myRole() { const s = await readDoc(db, 'roles/' + auth.currentUser.uid); return s.exists() ? s.data().role : null; },
  // First-time setup: makes this account the owner and manager, if no owner exists yet. Returns true on success.
  async claimOwner() {
    const uid = auth.currentUser.uid, email = auth.currentUser.email || '';
    try {
      const owner = await getDocFromServer(doc(db, 'meta/owner'));
      if (owner.exists()) return false;
      const b = writeBatch(db);
      b.set(doc(db, 'meta/owner'), { uid, email, claimedAt: new Date().toISOString() });
      b.set(doc(db, 'roles/' + uid), { role: 'manager', email, addedAt: new Date().toISOString(), addedBy: 'first sign-in' });
      await b.commit();
      return true;
    } catch (e) { console.warn('Owner setup refused', e); return false; }
  },
  async requestAccess() {
    const u = auth.currentUser;
    await commitOps(db, [{ type: 'set', coll: 'accessRequests', id: u.uid, data: { email: u.email || '', requestedAt: new Date().toISOString() } }]);
  },
  // Manager sign-in on a staff device (second, in-memory account; it is forgotten when the app closes).
  async startManager(email, password) {
    try {
      const a2 = initializeApp(firebaseConfig, 'manager-' + Date.now());
      const auth2 = getAuth(a2); await setPersistence(auth2, inMemoryPersistence);
      const db2 = initializeFirestore(a2, {});
      if (useEmulator) { connectAuthEmulator(auth2, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db2, '127.0.0.1', 8080); }
      const cred = await signInWithEmailAndPassword(auth2, email, password);
      const r = await getDocFromServer(doc(db2, 'roles/' + cred.user.uid));
      if (!r.exists() || r.data().role !== 'manager') { await signOut(auth2); return 'That account is not a manager.'; }
      mgr = { auth: auth2, db: db2, uid: cred.user.uid, email: cred.user.email };
      return '';
    } catch (e) { return friendlyAuthError(e); }
  },
  endManager() { if (mgr) { signOut(mgr.auth).catch(() => {}); mgr = null; } },
  managerEmail() { return mgr ? mgr.email : ''; },
  // Database to use for a collection: manager-only collections go through the manager sign-in when there is one.
  _dbFor(coll) { return mgr && MANAGER_COLLS.includes(coll) ? mgr.db : db; },
  async read(path) { const s = await readDoc(this._dbFor(path.split('/')[0]), path); return s.exists() ? { id: s.id, ...s.data() } : null; },
  async list(coll) { const d = this._dbFor(coll); let snap; try { snap = await getDocsFromServer(collection(d, coll)); } catch (e) { if (String(e.code).includes('permission')) throw e; snap = await getDocs(collection(d, coll)); } return snap.docs.map(x => ({ id: x.id, ...x.data() })); },
  // Calls cb(name, docs, fromCache, hasPendingWrites) whenever a collection changes, on any device.
  subscribe(names, cb, onError) {
    return names.map(name => onSnapshot(collection(db, name), { includeMetadataChanges: true },
      snap => cb(name, snap.docs.map(d => ({ id: d.id, ...d.data() })), snap.metadata.fromCache, snap.metadata.hasPendingWrites),
      err => onError && onError(name, err)));
  },
  // True when the cloud has no records yet (used once, to move records already saved on this device).
  async isEmpty(names) {
    for (const name of names) {
      let snap;
      try { snap = await getDocsFromServer(collection(db, name)); } catch (e) { snap = await getDocs(collection(db, name)); }
      if (!snap.empty) return false;
    }
    return true;
  },
  // ops: [{type:'set'|'delete', coll, id, data}]. The promise settles when the server confirms (or refuses) the save.
  // While offline it stays pending: Firestore keeps the change on the device and sends it when the connection returns.
  async write(ops) {
    const viaMgr = ops.filter(o => this._dbFor(o.coll) !== db), viaMain = ops.filter(o => this._dbFor(o.coll) === db);
    await Promise.all([viaMain.length && commitOps(db, viaMain), viaMgr.length && commitOps(mgr.db, viaMgr)].filter(Boolean));
  }
};
window._cloudResolve && window._cloudResolve(window.cloud);
