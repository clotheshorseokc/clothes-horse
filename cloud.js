// Connects the app to Firebase: staff sign-in (Firebase Auth) and cloud records (Firestore).
// app.js talks to this file only through window.cloud.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, writeBatch, getDocsFromServer, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// The offline cache keeps records on the iPad so the app still opens and saves without internet;
// changes made offline upload automatically when the connection returns.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const friendlyAuthError = err => {
  const code = (err && err.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) return 'That email and password do not match a staff account.';
  if (code.includes('too-many-requests')) return 'Too many tries. Please wait a few minutes and try again.';
  if (code.includes('network')) return 'No internet connection. Connect to Wi-Fi to sign in.';
  if (code.includes('user-disabled')) return 'This staff account has been turned off.';
  return 'Sign-in did not work. Please try again.';
};

window.cloud = {
  enabled: true,
  onUser(cb) { return onAuthStateChanged(auth, user => cb(user ? { uid: user.uid, email: user.email } : null)); },
  async signIn(email, password) { try { await signInWithEmailAndPassword(auth, email, password); return ''; } catch (e) { return friendlyAuthError(e); } },
  async resetPassword(email) { try { await sendPasswordResetEmail(auth, email); return ''; } catch (e) { return friendlyAuthError(e); } },
  signOut() { return signOut(auth); },
  // Checks the signed-in staff member's password again (used for the staff PIN). Needs internet.
  async verifyPassword(password) {
    const user = auth.currentUser;
    if (!user || !password) return 'Enter your Clothes Horse password.';
    try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); return ''; }
    catch (e) { const code = (e && e.code) || ''; if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'That password is not right. Please try again.'; return friendlyAuthError(e); }
  },
  // Calls cb(name, docs, fromCache, hasPendingWrites) whenever a collection changes, on any device.
  subscribe(names, cb, onError) {
    return names.map(name => onSnapshot(collection(db, name), { includeMetadataChanges: true },
      snap => cb(name, snap.docs.map(d => ({ id: d.id, ...d.data() })), snap.metadata.fromCache, snap.metadata.hasPendingWrites),
      err => onError && onError(name, err)));
  },
  // True when the cloud has no records yet (used once, to move records already saved on this iPad).
  async isEmpty(names) {
    for (const name of names) {
      let snap;
      try { snap = await getDocsFromServer(collection(db, name)); } catch (e) { snap = await getDocs(collection(db, name)); }
      if (!snap.empty) return false;
    }
    return true;
  },
  // ops: [{type:'set'|'delete', coll, id, data}]. Firestore allows 500 writes per batch.
  async write(ops) {
    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(db);
      ops.slice(i, i + 450).forEach(op => {
        const ref = doc(db, op.coll, op.id);
        if (op.type === 'delete') batch.delete(ref); else batch.set(ref, op.data);
      });
      await batch.commit();
    }
  }
};
window._cloudResolve && window._cloudResolve(window.cloud);
