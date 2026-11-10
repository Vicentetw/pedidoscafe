// Preload SÓLO para tests locales (NODE_OPTIONS=--require, lo pone
// scripts/test-local.sh): reemplaza firebase-admin y la llamada a
// identitytoolkit, y bloquea toda red externa — así la suite corre SIN tocar
// el proyecto real de Firebase (restiapedidos = producción).
const Module = require('module');
const origLoad = Module._load;
const users = new Map();
const auth = {
  createCustomToken: async (uid) => 'fake:' + uid,
  verifyIdToken: async (t) => {
    if (!String(t).startsWith('fake:')) throw new Error('token inválido');
    return { uid: String(t).slice(5) };
  },
  deleteUser: async (uid) => { users.delete(uid); },
  getUserByEmail: async (email) => {
    const u = [...users.values()].find((x) => x.email === email);
    if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; }
    return u;
  },
  createUser: async ({ email }) => { const u = { uid: 'fake-' + email, email }; users.set(u.uid, u); return u; },
  updateUser: async (uid) => ({ uid }),
  generatePasswordResetLink: async () => 'https://fake.invalid/reset',
};
const fake = { apps: [{}], initializeApp() {}, credential: { cert: (x) => x }, auth: () => auth };
Module._load = function (request, ...rest) {
  if (request === 'firebase-admin') return fake;
  return origLoad.call(this, request, ...rest);
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('identitytoolkit.googleapis.com')) {
    const { token } = JSON.parse(opts.body);
    return new Response(JSON.stringify({ idToken: token }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(u)) throw new Error('red externa bloqueada en el test: ' + u);
  return realFetch(url, opts);
};

