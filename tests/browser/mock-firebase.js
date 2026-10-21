/*
 * Sustituto mínimo del SDK de Firebase para probar la interfaz en un navegador sin tocar el
 * proyecto real. serve-preview.mjs lo conecta con un import map en lugar de las URL de
 * gstatic.com. Los datos y el usuario se leen de window.__MOCK (ver mock-data.js).
 *
 * Aplica una versión simplificada de los permisos para comprobar los mensajes de la interfaz;
 * las reglas reales se prueban con el emulador en tests/rules-pae.test.mjs.
 */

// El mismo archivo se sirve como cuatro módulos distintos (app, auth, database, functions); el
// estado compartido vive en window.__MOCK.
const mock = window.__MOCK;
if (!mock.listeners) mock.listeners = new Set();
if (!mock.calls) mock.calls = [];
const listeners = mock.listeners;

function pathParts(path) {
  return String(path || "").split("/").filter(Boolean);
}

function readPath(path) {
  let node = mock.db;
  for (const part of pathParts(path)) {
    if (node === null || typeof node !== "object") return null;
    node = node[part];
    if (node === undefined) return null;
  }
  return node === undefined ? null : JSON.parse(JSON.stringify(node));
}

function writePath(path, value) {
  const parts = pathParts(path);
  let node = mock.db;
  parts.slice(0, -1).forEach((part) => {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  });
  const last = parts.at(-1);
  if (value === null || value === undefined) delete node[last];
  else node[last] = JSON.parse(JSON.stringify(value));
}

// Consultas simplificadas: orderByKey / orderByChild con startAt, endAt y endBefore.
function applyQuery(value, constraints) {
  if (!constraints || !constraints.length || !value || typeof value !== "object") return value;
  const order = constraints.find((item) => item.type === "orderByChild");
  const keyOf = ([key, child]) => {
    const raw = order ? (child && typeof child === "object" ? child[order.child] : undefined) : key;
    return raw === undefined || raw === null ? null : String(raw);
  };
  let entries = Object.entries(value);
  constraints.forEach((item) => {
    if (item.type === "startAt") entries = entries.filter((entry) => keyOf(entry) !== null && keyOf(entry) >= item.value);
    if (item.type === "endAt") entries = entries.filter((entry) => keyOf(entry) !== null && keyOf(entry) <= item.value);
    if (item.type === "endBefore") entries = entries.filter((entry) => keyOf(entry) === null || keyOf(entry) < item.value);
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function snapshot(path, constraints) {
  const value = applyQuery(readPath(path), constraints);
  return { val: () => value, exists: () => value !== null };
}

function notify() {
  listeners.forEach((listener) => {
    setTimeout(() => listener.callback(snapshot(listener.path, listener.constraints)), mock.latencyMs || 0);
  });
}

function role() {
  const profile = mock.db.usuarios && mock.db.usuarios[mock.user && mock.user.uid];
  return profile && profile.activo === true ? profile.rol : "";
}

// Como en las reglas: el personal crea almuerzos (nunca reemplaza uno) y quita los suyos;
// directivo y admin escriben todo lo del PAE.
function canWrite(path, value) {
  const current = role();
  if (current === "directivo" || current === "admin") return path.startsWith("pae/");
  if (current !== "docente") return false;
  if (!/^pae\/asistencia\/[^/]+\/[^/]+$/.test(path)) return false;
  const existing = readPath(path);
  if (value === null) return Boolean(existing) && existing.manual && existing.manual.porUid === mock.user.uid;
  return existing === null && value.manual && value.manual.motivo !== "correccion";
}

function denied() {
  const error = new Error("PERMISSION_DENIED");
  error.code = "PERMISSION_DENIED";
  return error;
}

// firebase-app
export function initializeApp(config) { return { config }; }

// firebase-auth
let authCallback = null;
export function getAuth() { return {}; }
export const browserSessionPersistence = { type: "SESSION" };
export async function setPersistence() {}
export function onAuthStateChanged(auth, callback) {
  authCallback = callback;
  setTimeout(() => callback(mock.user || null), 0);
  return () => { authCallback = null; };
}
export async function signInWithEmailAndPassword() {
  mock.user = mock.loginAs;
  if (authCallback) authCallback(mock.user);
  return { user: mock.user };
}
export async function signOut() {
  mock.user = null;
  if (authCallback) authCallback(null);
}

// firebase-database
export function getDatabase() { return {}; }
export function ref(database, path) { return { path: path || "" }; }
// En Firebase real el servidor reemplaza este marcador por su hora; aquí se usa la del navegador.
export function serverTimestamp() { return Date.now(); }
export function onValue(reference, callback) {
  const listener = { path: reference.path, constraints: reference.constraints, callback };
  listeners.add(listener);
  setTimeout(() => callback(snapshot(reference.path, reference.constraints)), mock.latencyMs || 0);
  return () => listeners.delete(listener);
}
export async function get(reference) { return snapshot(reference.path, reference.constraints); }
export function query(reference, ...constraints) { return { path: reference.path, constraints }; }
export function orderByKey() { return { type: "orderByKey" }; }
export function orderByChild(child) { return { type: "orderByChild", child }; }
export function startAt(value) { return { type: "startAt", value }; }
export function endAt(value) { return { type: "endAt", value }; }
export function endBefore(value) { return { type: "endBefore", value }; }
export async function set(reference, value) {
  mock.calls.push({ op: "set", path: reference.path, value });
  await new Promise((resolve) => setTimeout(resolve, mock.latencyMs || 0));
  if (!canWrite(reference.path, value)) throw denied();
  writePath(reference.path, value);
  notify();
}
export async function update(reference, values) {
  mock.calls.push({ op: "update", path: reference.path, value: values });
  await new Promise((resolve) => setTimeout(resolve, mock.latencyMs || 0));
  const entries = Object.entries(values).map(([key, value]) => [pathParts(reference.path + "/" + key).join("/"), value]);
  if (!entries.every(([path, value]) => canWrite(path, value))) throw denied();
  entries.forEach(([path, value]) => writePath(path, value));
  notify();
}
export async function remove(reference) {
  mock.calls.push({ op: "remove", path: reference.path });
  await new Promise((resolve) => setTimeout(resolve, mock.latencyMs || 0));
  if (!canWrite(reference.path, null)) throw denied();
  writePath(reference.path, null);
  notify();
}

window.__mockApi = { writePath, notify, readPath };
