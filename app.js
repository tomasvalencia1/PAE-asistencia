/*
 * Panel de asistencia al almuerzo del PAE (modalidad Comida Caliente Transportada, CCT) · IERUU.
 *
 * Usa el mismo proyecto de Firebase y las mismas cuentas del panel de llegadas tarde, pero todos
 * sus datos viven aparte, en /pae, para no interferir con ese sistema:
 *   pae/beneficiarios/<matrícula>   { matricula, nombre, grupo, estado, orden, desde?, chip? }
 *   pae/chips/<UID del chip>        "<matrícula>"  (el lector del restaurante busca aquí)
 *   pae/asistencia/<día>/<matrícula> registro de almuerzo (chip del lector o manual del panel)
 *   pae/diasSinClases/<id>          días sin clases marcados en este panel
 *   pae/config/cierre               hora desde la que «sin registro» pasa a «no asistió»
 * Sólo se leen, sin modificarlos: /usuarios (rol), config/diasSinClases (días sin clases del panel
 * de llegadas tarde) y /estudiantes (para proponer el chip de cada beneficiario).
 *
 * Los permisos reales no dependen de los botones: database.rules.json los aplica también en
 * Firebase para que nadie modifique datos desde las herramientas del navegador.
 *
 * Organización de la pantalla (pensada para la fila del restaurante):
 * 1. Buscar al estudiante (Enter lo marca si hay un solo resultado) o elegir su grupo.
 * 2. Tocar su nombre: queda «asistió al almuerzo» (registro manual, sin chip), con «Deshacer».
 * 3. Al pasar la hora de cierre, quien no tiene registro queda «no asistió al almuerzo».
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  endAt,
  get,
  getDatabase,
  onValue,
  orderByKey,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  startAt,
  update
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  CELL,
  DEFAULT_CIERRE,
  DEFAULT_ESTADO,
  GRADES,
  GROUPS,
  MANUAL_REASON_LABELS,
  addDays,
  bogotaParts,
  cellState,
  cierreSeconds,
  cleanName,
  clockLabel,
  compareBeneficiaries,
  compareGroups,
  dayCount,
  dayState,
  formatDayLong,
  formatMonth,
  isDayKey,
  matchChips,
  monthKeyOf,
  nextOrder,
  noClassPeriodFor,
  noClassPeriodsOn,
  normalizeAttendance,
  normalizeBeneficiaries,
  normalizeDay,
  normalizeGroup,
  normalizeMatricula,
  normalizeNoClassPeriods,
  normalizeUid,
  parseRoster,
  periodRange,
  plural,
  runReport,
  searchText,
  secondsNow,
  secondsOfDay,
  shiftMonth,
  text,
  timeOfDay,
  todayKey,
  weekdayFromMonday
} from "./query.js";
import { createStatsView, savedJornada } from "./stats.js";
import { exportToXlsx } from "./export-xlsx.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);

const STAFF_ROLES = new Set(["docente", "directivo", "admin"]);
const MANAGER_ROLES = new Set(["directivo", "admin"]);
const ROLE_LABELS = {
  docente: "Docente",
  directivo: "Directivo",
  admin: "Administrador",
  lector: "Lector (restaurante)"
};
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const GROUP_STORAGE_KEY = "ieruu.pae.grupo";
const INACTIVITY_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutos
// Cada cuánto se revisa si cambió el día o si ya pasó la hora de cierre del almuerzo.
const CLOCK_TICK_MS = 30 * 1000;
// Los informes reutilizan lo consultado durante este tiempo (el botón «Actualizar» lo ignora).
const REPORT_CACHE_MS = 2 * 60 * 1000;
// Un registro manual propio se puede quitar durante este tiempo (igual que en las reglas).
const OWN_UNDO_MS = 24 * 60 * 60 * 1000;

const groupCollator = new Intl.Collator("es-CO", { numeric: true, sensitivity: "base" });

const $ = (selector) => document.querySelector(selector);
const elements = {
  loginView: $("#loginView"),
  appView: $("#appView"),
  loginForm: $("#loginForm"),
  emailInput: $("#emailInput"),
  passwordInput: $("#passwordInput"),
  loginButton: $("#loginButton"),
  loginError: $("#loginError"),
  logoutButton: $("#logoutButton"),
  userName: $("#userName"),
  userRole: $("#userRole"),
  searchInput: $("#searchInput"),
  statsButton: $("#statsButton"),
  calendarButton: $("#calendarButton"),
  manageButton: $("#manageButton"),
  dayLabel: $("#dayLabel"),
  dayStateLabel: $("#dayStateLabel"),
  dayControls: $("#dayControls"),
  dayPrev: $("#dayPrev"),
  dayNext: $("#dayNext"),
  dayInput: $("#dayInput"),
  dayToday: $("#dayToday"),
  syncStatus: $("#syncStatus"),
  dataWarning: $("#dataWarning"),
  groupPicker: $("#groupPicker"),
  groupPanel: $("#groupPanel"),
  activeGroupLabel: $("#activeGroupLabel"),
  activeGroupTitle: $("#activeGroupTitle"),
  activeGroupCount: $("#activeGroupCount"),
  groupExcelButton: $("#groupExcelButton"),
  addBeneficiaryButton: $("#addBeneficiaryButton"),
  summarySection: $("#summarySection"),
  summaryAsistio: $("#summaryAsistio"),
  summaryMissing: $("#summaryMissing"),
  summaryMissingLabel: $("#summaryMissingLabel"),
  summaryTotal: $("#summaryTotal"),
  summaryBar: $("#summaryBar"),
  dayNotice: $("#dayNotice"),
  listFilters: $("#listFilters"),
  listFilterInputs: [...document.querySelectorAll("input[name='listFilter']")],
  filterAllLabel: $("#filterAllLabel"),
  filterMissingLabel: $("#filterMissingLabel"),
  filterDoneLabel: $("#filterDoneLabel"),
  lunchList: $("#lunchList"),
  toast: $("#toast"),
  toastText: $("#toastText"),
  toastUndo: $("#toastUndo"),
  beneficiaryDialog: $("#beneficiaryDialog"),
  beneficiaryForm: $("#beneficiaryForm"),
  beneficiaryDialogTitle: $("#beneficiaryDialogTitle"),
  beneficiaryMatriculaInput: $("#beneficiaryMatriculaInput"),
  beneficiaryGroupInput: $("#beneficiaryGroupInput"),
  beneficiaryNameInput: $("#beneficiaryNameInput"),
  beneficiaryEstadoInput: $("#beneficiaryEstadoInput"),
  beneficiaryDesdeInput: $("#beneficiaryDesdeInput"),
  beneficiaryChipInput: $("#beneficiaryChipInput"),
  beneficiaryHint: $("#beneficiaryHint"),
  beneficiaryError: $("#beneficiaryError"),
  removeBeneficiaryButton: $("#removeBeneficiaryButton"),
  saveBeneficiaryButton: $("#saveBeneficiaryButton"),
  manageDialog: $("#manageDialog"),
  importGroupInput: $("#importGroupInput"),
  importDesdeInput: $("#importDesdeInput"),
  importText: $("#importText"),
  importSummary: $("#importSummary"),
  importErrors: $("#importErrors"),
  importButton: $("#importButton"),
  chipSearchButton: $("#chipSearchButton"),
  chipSummary: $("#chipSummary"),
  chipMatches: $("#chipMatches"),
  chipLinkButton: $("#chipLinkButton"),
  cierreForm: $("#cierreForm"),
  cierreInput: $("#cierreInput"),
  cierreSave: $("#cierreSave"),
  cierreStatus: $("#cierreStatus"),
  statsDialog: $("#statsDialog"),
  calendarDialog: $("#calendarDialog"),
  calendarMonthLabel: $("#calendarMonthLabel"),
  calendarPrev: $("#calendarPrev"),
  calendarNext: $("#calendarNext"),
  calendarGrid: $("#calendarGrid"),
  calendarForm: $("#calendarForm"),
  calendarFrom: $("#calendarFrom"),
  calendarTo: $("#calendarTo"),
  calendarReason: $("#calendarReason"),
  calendarSummary: $("#calendarSummary"),
  calendarError: $("#calendarError"),
  calendarClear: $("#calendarClear"),
  calendarSave: $("#calendarSave"),
  calendarList: $("#calendarList"),
  calendarScopeInputs: [...document.querySelectorAll("input[name='calendarScope']")],
  calendarGroups: $("#calendarGroups")
};

let inactivityTimer = null;
let toastTimer = null;
let toastUndo = null;

const state = {
  authUser: null,
  profile: null,
  sessionId: 0,
  rawBeneficiaries: {},
  beneficiaries: [],
  chips: {},
  // Almuerzos del día que se está viendo (hoy, o un día anterior que corrige un directivo).
  day: todayKey(),
  followToday: true,
  dayRecords: new Map(),
  dayLoaded: false,
  dayStateShown: "",
  ownNoClass: {},
  sharedNoClass: {},
  noClass: [],
  cierre: DEFAULT_CIERRE,
  serverOffset: 0,
  activeGroup: savedGroup(),
  search: "",
  listFilter: "todos",
  // Almuerzos que se están guardando ("día|matrícula"): evitan el doble toque.
  pending: new Set(),
  unsubscribe: {},
  calendar: { month: "", start: "", end: "", notice: "" },
  editing: null,
  importRows: [],
  chipProposals: [],
  reportCache: new Map()
};

/* ---------- Utilidades ---------- */

function savedGroup() {
  try {
    const stored = window.localStorage.getItem(GROUP_STORAGE_KEY);
    if (GROUPS.includes(stored)) return stored;
  } catch (error) {
    // Navegación privada o almacenamiento bloqueado: se empieza por el primer grupo.
  }
  return GROUPS[0];
}

function rememberGroup(group) {
  try {
    window.localStorage.setItem(GROUP_STORAGE_KEY, group);
  } catch (error) {
    // No es necesario recordar el grupo para usar el panel.
  }
}

function createElement(tagName, className, content) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function roleLabel(role) {
  return ROLE_LABELS[role] || "Sin rol";
}

function isActiveStaff(profile) {
  return Boolean(profile) && profile.activo === true && STAFF_ROLES.has(text(profile.rol));
}

function canManage() {
  return isActiveStaff(state.profile) && MANAGER_ROLES.has(text(state.profile.rol));
}

// Hora del servidor de Firebase, como en el lector: no depende de que el reloj del equipo esté bien.
function serverNow() {
  return Date.now() + state.serverOffset;
}

// "2026-10-01" → "jue 1 de oct"
function shortDayLabel(day) {
  const match = text(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "Fecha sin identificar";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return WEEKDAYS[date.getUTCDay()] + " " + String(Number(match[3])) + " de " + MONTHS[Number(match[2]) - 1];
}

function setStatus(message, isError) {
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.toggle("error", Boolean(isError));
  elements.syncStatus.classList.toggle("live", !isError && message.includes("en vivo"));
}

function liveStatus() {
  setStatus("Conexión en vivo · actualizado " + new Date().toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }), false);
}

function showFormError(node, message) {
  node.textContent = message;
  node.hidden = !message;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function hideToast() {
  clearTimeout(toastTimer);
  elements.toast.hidden = true;
  toastUndo = null;
}

// Aviso breve abajo de la pantalla. Con `undo`, muestra «Deshacer» unos segundos.
function showToast(message, options) {
  const settings = options || {};
  elements.toastText.textContent = message;
  elements.toast.classList.toggle("is-error", Boolean(settings.error));
  toastUndo = settings.undo || null;
  elements.toastUndo.hidden = !toastUndo;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastUndo ? 7000 : 4500);
}

/* ---------- Sesión ---------- */

function showLoginError(message) {
  showFormError(elements.loginError, message);
}

function showLogin() {
  [elements.beneficiaryDialog, elements.manageDialog, elements.statsDialog, elements.calendarDialog].forEach(closeDialog);
  hideToast();
  elements.appView.hidden = true;
  elements.loginView.hidden = false;
  elements.passwordInput.value = "";
}

function showApp() {
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  elements.loginForm.reset();
  elements.userName.textContent = text(state.profile.nombre) || text(state.authUser.email) || "Usuario";
  elements.userRole.textContent = roleLabel(text(state.profile.rol));
  elements.addBeneficiaryButton.hidden = !canManage();
  elements.manageButton.hidden = !canManage();
  elements.dayControls.hidden = !canManage();
  // Un docente sólo marca el almuerzo de hoy.
  if (!canManage() && !state.followToday) goToDay(todayKey(serverNow()));
}

function profileErrorMessage(error) {
  if (error && error.code === "PERMISSION_DENIED") {
    return "Tu cuenta no puede leer su perfil. Revisa usuarios y las reglas de Firebase.";
  }
  return "No se pudo comprobar tu rol. Verifica Internet y la configuración de Firebase.";
}

function loginErrorMessage(error) {
  const code = error && error.code ? error.code : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "El correo o la contraseña no son correctos.";
  }
  if (code === "auth/invalid-email") return "Escribe un correo válido.";
  if (code === "auth/too-many-requests") return "Hay demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  return "No fue posible iniciar sesión. Verifica Internet e inténtalo de nuevo.";
}

function detachDatabaseListeners() {
  Object.values(state.unsubscribe).forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
  state.unsubscribe = {};
}

// El perfil se sigue en vivo: si administración desactiva la cuenta o le quita el rol con el
// panel abierto, se cierra la sesión (y se borran los datos cargados); si le cambia el rol, se aplica.
function watchProfile(uid) {
  state.unsubscribe.profile = onValue(
    ref(database, "usuarios/" + uid),
    (snapshot) => {
      const profile = snapshot.val();
      if (!isActiveStaff(profile)) {
        showLoginError("Tu cuenta fue desactivada o ya no tiene rol en el panel. Pide a administración que la habilite.");
        signOut(auth).catch((error) => console.warn("No se pudo cerrar la sesión", error));
        return;
      }
      if (text(profile.rol) === text(state.profile.rol) && profile.nombre === state.profile.nombre) return;
      state.profile = profile;
      showApp();
      render();
    },
    (error) => console.warn("No fue posible seguir el perfil del usuario", error)
  );
}

function refreshNoClass() {
  state.noClass = normalizeNoClassPeriods(state.ownNoClass, state.sharedNoClass);
}

function subscribeToData() {
  state.unsubscribe.beneficiaries = onValue(
    ref(database, "pae/beneficiarios"),
    (snapshot) => {
      state.rawBeneficiaries = snapshot.val() || {};
      state.beneficiaries = normalizeBeneficiaries(state.rawBeneficiaries);
      render();
      liveStatus();
      if (statsView.isOpen()) statsView.refresh();
    },
    () => setStatus("No fue posible leer los beneficiarios. Revisa tu conexión o las reglas de Firebase.", true)
  );

  state.unsubscribe.chips = onValue(
    ref(database, "pae/chips"),
    (snapshot) => { state.chips = snapshot.val() || {}; },
    (error) => console.warn("No fue posible leer los chips", error)
  );

  state.unsubscribe.ownNoClass = onValue(
    ref(database, "pae/diasSinClases"),
    (snapshot) => {
      state.ownNoClass = snapshot.val() || {};
      refreshNoClass();
      render();
      if (elements.calendarDialog.open) renderCalendar();
      if (statsView.isOpen()) statsView.refresh();
    },
    (error) => console.warn("No fue posible leer los días sin clases del PAE", error)
  );

  // Los días sin clases del panel de llegadas tarde también cuentan (sólo se leen).
  state.unsubscribe.sharedNoClass = onValue(
    ref(database, "config/diasSinClases"),
    (snapshot) => {
      state.sharedNoClass = snapshot.val() || {};
      refreshNoClass();
      render();
      if (elements.calendarDialog.open) renderCalendar();
      if (statsView.isOpen()) statsView.refresh();
    },
    (error) => {
      console.warn("No fue posible leer los días sin clases del panel de llegadas tarde", error);
      state.sharedNoClass = {};
    }
  );

  state.unsubscribe.cierre = onValue(
    ref(database, "pae/config/cierre"),
    (snapshot) => {
      state.cierre = secondsOfDay(snapshot.val()) === null ? DEFAULT_CIERRE : text(snapshot.val());
      render();
      if (elements.manageDialog.open && document.activeElement !== elements.cierreInput) fillCierreInput();
    },
    (error) => console.warn("No fue posible leer la hora de cierre", error)
  );

  state.unsubscribe.offset = onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    const offset = Number(snapshot.val());
    state.serverOffset = Number.isFinite(offset) ? offset : 0;
  });

  subscribeDay(state.day);
}

// Sólo se escucha en vivo el día que se está viendo: así el panel no descarga todo el año.
function subscribeDay(day) {
  if (state.unsubscribe.day) state.unsubscribe.day();
  state.day = day;
  state.dayRecords = new Map();
  state.dayLoaded = false;
  state.unsubscribe.day = onValue(
    ref(database, "pae/asistencia/" + day),
    (snapshot) => {
      if (state.day !== day) return;
      state.dayRecords = normalizeDay(snapshot.val() || {}, day);
      state.dayLoaded = true;
      render();
      liveStatus();
    },
    () => setStatus("No fue posible leer los almuerzos del día. Revisa tu conexión o las reglas de Firebase.", true)
  );
}

function goToDay(day) {
  const today = todayKey(serverNow());
  const target = !isDayKey(day) || day > today || !canManage() ? today : day;
  state.followToday = target === today;
  if (target !== state.day || !state.unsubscribe.day) {
    if (state.authUser) subscribeDay(target);
    else state.day = target;
  }
  render();
}

/* ---------- Modelo de la pantalla ---------- */

function buildModel() {
  const now = serverNow();
  const today = todayKey(now);
  const context = {
    today,
    nowSeconds: secondsNow(now),
    cierreSeconds: cierreSeconds(state.cierre),
    attendance: new Map([[state.day, state.dayRecords]])
  };
  const dState = state.dayLoaded ? dayState(state.day, context) : "en-curso";
  const items = state.beneficiaries.map((beneficiary) => {
    const noClass = noClassPeriodFor(state.noClass, state.day, beneficiary.grupo);
    const record = state.dayRecords.get(beneficiary.matricula) || null;
    return { beneficiary, record, noClass, cell: cellState(beneficiary, state.day, dState, record, noClass) };
  });
  // Almuerzos de quien ya no está en la lista (se muestran sólo para consulta).
  const known = new Set(state.beneficiaries.map((beneficiary) => beneficiary.matricula));
  const orphans = [...state.dayRecords.values()]
    .filter((record) => !known.has(record.matricula))
    .map((record) => ({ beneficiary: null, record, noClass: null, cell: CELL.ASISTIO }));
  return { today, dState, items, orphans };
}

function canMark(item, model) {
  return isActiveStaff(state.profile) &&
    Boolean(item.beneficiary) &&
    !item.record &&
    !item.noClass &&
    state.dayLoaded &&
    state.day <= model.today &&
    (state.day === model.today || canManage()) &&
    !state.pending.has(state.day + "|" + item.beneficiary.matricula);
}

function canRemove(record) {
  if (!record || !isActiveStaff(state.profile)) return false;
  if (canManage()) return true;
  return record.via === "manual" &&
    record.porUid === state.authUser.uid &&
    (!record.registradoEn || record.registradoEn > serverNow() - OWN_UNDO_MS + 60000);
}

/* ---------- Presentación ---------- */

function renderDayBar(model) {
  const isToday = state.day === model.today;
  elements.dayLabel.textContent = (isToday ? "Hoy · " : "") + formatDayLong(state.day);
  const cierre = clockLabel(state.cierre);
  let label = "Cargando…";
  let kind = "empty";
  if (state.dayLoaded) {
    if (model.dState === "en-curso") {
      label = "Almuerzo en curso · cierra a las " + cierre;
      kind = "pendiente";
    } else if (model.dState === "cerrado") {
      label = isToday ? "Almuerzo cerrado (desde las " + cierre + ")" : "Día cerrado";
      kind = "validada";
    } else {
      label = "Nadie registró almuerzo ese día";
    }
  }
  elements.dayStateLabel.textContent = label;
  elements.dayStateLabel.className = "state-pill state-" + kind;
  elements.dayInput.max = model.today;
  elements.dayInput.value = state.day;
  elements.dayNext.disabled = state.day >= model.today;
  elements.dayToday.disabled = isToday;
}

function renderWarning() {
  const invalid = state.beneficiaries.filter((beneficiary) => !GROUPS.includes(beneficiary.grupo));
  elements.dataWarning.hidden = !invalid.length;
  if (invalid.length) {
    elements.dataWarning.textContent =
      plural(invalid.length, "beneficiario no aparece", "beneficiarios no aparecen") +
      " en ningún grupo porque su grupo no es de 6.1 a 11.3. Corrígelo desde «Beneficiarios».";
  }
}

function selectGroup(group) {
  state.activeGroup = group;
  rememberGroup(group);
  if (state.search) {
    state.search = "";
    elements.searchInput.value = "";
  }
  render();
  // En el celular el grupo queda debajo de los botones: se lleva la vista hasta él.
  if (window.matchMedia("(max-width: 800px)").matches) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    elements.groupPanel.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }
}

function renderGroupPicker(model) {
  const counts = new Map(GROUPS.map((group) => [group, { total: 0, done: 0, off: false }]));
  model.items.forEach((item) => {
    const count = counts.get(item.beneficiary.grupo);
    if (!count) return;
    count.total += 1;
    if (item.record) count.done += 1;
    if (item.noClass) count.off = true;
  });

  elements.groupPicker.replaceChildren();
  GRADES.forEach(({ grade, label }) => {
    const box = createElement("div", "grade-box");
    box.append(createElement("span", "grade-label", label));
    const buttons = createElement("div", "grade-buttons");
    for (let section = 1; section <= 3; section += 1) {
      const group = String(grade) + "." + String(section);
      const count = counts.get(group);
      const button = createElement("button", "group-button");
      button.type = "button";
      button.append(createElement("span", "group-name", group));
      const progress = count.off ? "sin clases" : count.total ? count.done + "/" + count.total : "—";
      button.append(createElement("span", "group-progress", progress));
      if (count.total && count.done === count.total) button.classList.add("is-complete");
      const selected = !state.search && group === state.activeGroup;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-label", "Grupo " + group + ", " + (count.off
        ? "sin clases"
        : plural(count.done, "almuerzo", "almuerzos") + " de " + plural(count.total, "beneficiario", "beneficiarios")));
      button.addEventListener("click", () => selectGroup(group));
      buttons.append(button);
    }
    box.append(buttons);
    elements.groupPicker.append(box);
  });
}

function statusLabel(item) {
  const record = item.record;
  if (item.beneficiary && state.pending.has(state.day + "|" + item.beneficiary.matricula)) return "Guardando…";
  if (record) {
    return "Almorzó " + clockLabel(record.hora) + " · " + (record.via === "manual" ? "a mano" : "chip");
  }
  if (item.cell === CELL.SIN_CLASES) return "Sin clases";
  if (item.cell === CELL.NO_ASISTIO) return "No asistió al almuerzo";
  if (item.cell === CELL.NO_APLICA) return "Aún no estaba en el PAE";
  return "Sin registro";
}

function renderRow(item, model, options) {
  const { beneficiary, record } = item;
  const name = beneficiary ? beneficiary.nombre : record.nombre;
  const row = createElement("article", "lunch-row cell-" + item.cell + (beneficiary ? "" : " is-orphan"));
  const markable = canMark(item, model);
  const main = createElement(markable ? "button" : "div", "lunch-main");
  if (markable) {
    main.type = "button";
    main.setAttribute("aria-label", "Marcar que " + name + " asistió al almuerzo");
    main.addEventListener("click", () => markLunch(beneficiary));
  }

  main.append(createElement("span", "lunch-check", record ? "✓" : item.cell === CELL.NO_ASISTIO ? "✗" : ""));
  const info = createElement("span", "lunch-info");
  const title = createElement("span", "lunch-title");
  if (beneficiary && !options.showGroup && beneficiary.orden !== Number.MAX_SAFE_INTEGER) {
    title.append(createElement("span", "lunch-order", String(options.position)));
  }
  title.append(createElement("strong", "lunch-name", name));
  info.append(title);

  const meta = [];
  if (options.showGroup) meta.push(beneficiary && beneficiary.grupo ? "Grupo " + beneficiary.grupo : "Sin grupo");
  meta.push("Mat. " + (beneficiary ? beneficiary.matricula : record.matricula));
  if (beneficiary) meta.push(beneficiary.chip ? "Con chip" : "Sin chip");
  else meta.push("Ya no está en la lista del PAE");
  info.append(createElement("small", "lunch-meta", meta.join(" · ")));
  if (record && record.via === "manual") {
    info.append(createElement(
      "small",
      "lunch-manual",
      "A mano: " + (MANUAL_REASON_LABELS[record.motivo] || "sin motivo") + (record.porNombre ? " · " + record.porNombre : "")
    ));
  }
  main.append(info);
  const pill = createElement("span", "lunch-status", statusLabel(item));
  if (record) pill.title = record.registro;
  main.append(pill);
  row.append(main);

  const actions = createElement("div", "lunch-actions");
  if (record && beneficiary && canRemove(record)) {
    const removeButton = createElement("button", "small-button danger", "Quitar");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "Quitar el almuerzo registrado de " + name);
    removeButton.addEventListener("click", () => removeLunch(beneficiary, record));
    actions.append(removeButton);
  }
  if (beneficiary && canManage()) {
    const editButton = createElement("button", "small-button", "Editar");
    editButton.type = "button";
    editButton.setAttribute("aria-label", "Editar los datos de " + name);
    editButton.addEventListener("click", () => openBeneficiaryDialog(beneficiary));
    actions.append(editButton);
  }
  if (actions.childElementCount) row.append(actions);
  return row;
}

function searchMatches(model) {
  const search = searchText(state.search);
  if (!search) return [];
  const upper = state.search.replace(/\s+/g, "").toUpperCase();
  const exact = model.items.filter((item) => item.beneficiary.matricula === upper);
  if (exact.length) return exact;
  return model.items
    .filter((item) =>
      item.beneficiary.searchName.includes(search) ||
      item.beneficiary.matricula.includes(upper) ||
      (upper.length >= 4 && item.beneficiary.chip.includes(upper)))
    .sort((first, second) => {
      if (first.beneficiary.grupo !== second.beneficiary.grupo) return compareGroups(first.beneficiary.grupo, second.beneficiary.grupo);
      return groupCollator.compare(first.beneficiary.nombre, second.beneficiary.nombre);
    });
}

function renderGroup(model) {
  const isSearching = Boolean(searchText(state.search));
  const members = model.items
    .filter((item) => item.beneficiary.grupo === state.activeGroup)
    .sort((first, second) => compareBeneficiaries(first.beneficiary, second.beneficiary));
  const orphans = model.orphans.filter((item) => item.record.grupo === state.activeGroup);
  const done = members.filter((item) => item.record);
  const missing = members.filter((item) => !item.record && !item.noClass && item.cell !== CELL.NO_APLICA);
  const closed = model.dState === "cerrado";

  elements.activeGroupLabel.textContent = isSearching ? "Búsqueda en todos los grupos" : "Grupo seleccionado";
  elements.activeGroupTitle.textContent = isSearching ? "Resultados de «" + state.search + "»" : "Grupo " + state.activeGroup;
  elements.groupExcelButton.hidden = isSearching;
  elements.summarySection.hidden = isSearching;
  elements.listFilters.hidden = isSearching;

  const off = noClassPeriodFor(state.noClass, state.day, state.activeGroup);
  let notice = "";
  if (!isSearching && off) {
    notice = (off.groups ? "El grupo " + state.activeGroup + " no tiene clases" : "No hay clases") +
      (state.day === model.today ? " hoy" : " ese día") + ": " + off.motivo + ". No se registran almuerzos ni ausencias.";
  } else if (!isSearching && state.dayLoaded && model.dState === "sin-servicio") {
    notice = "Ese día nadie del colegio registró almuerzo, así que no se marcó a nadie como «no asistió». " +
      "Si sí hubo servicio, marca a quienes almorzaron.";
  } else if (!isSearching && state.day !== model.today) {
    notice = "Estás corrigiendo el " + shortDayLabel(state.day) + ": lo que marques queda como «corrección posterior» a tu nombre.";
  }
  elements.dayNotice.hidden = !notice;
  elements.dayNotice.textContent = notice;

  if (isSearching) {
    const matches = searchMatches(model);
    elements.activeGroupCount.textContent = plural(matches.length, "resultado", "resultados") +
      (matches.length === 1 && canMark(matches[0], model) ? " · pulsa Enter para marcar el almuerzo" : "");
    renderList(matches, model, { showGroup: true, emptyTitle: "No hay coincidencias", emptyText: "Prueba con otra parte del nombre, la matrícula o el código del chip." });
    return;
  }

  elements.activeGroupCount.textContent = plural(members.length, "beneficiario", "beneficiarios") +
    " · " + plural(members.filter((item) => item.beneficiary.chip).length, "con chip", "con chip");
  elements.summaryAsistio.textContent = String(done.length);
  elements.summaryMissing.textContent = String(missing.length);
  elements.summaryMissingLabel.textContent = closed ? "No asistieron" : model.dState === "sin-servicio" ? "Sin registro" : "Faltan";
  elements.summaryTotal.textContent = String(members.length);
  const counted = done.length + missing.length;
  elements.summaryBar.style.width = (counted ? Math.round((done.length / counted) * 100) : 0) + "%";
  elements.filterAllLabel.textContent = "Todos (" + members.length + ")";
  elements.filterMissingLabel.textContent = (closed ? "No asistieron" : "Faltan") + " (" + missing.length + ")";
  elements.filterDoneLabel.textContent = "Almorzaron (" + done.length + ")";

  let visible = members;
  if (state.listFilter === "faltan") visible = missing;
  if (state.listFilter === "almorzaron") visible = done;
  const positions = new Map(members.map((item, index) => [item.beneficiary.matricula, index + 1]));
  renderList(state.listFilter === "faltan" ? visible : [...visible, ...orphans], model, {
    showGroup: false,
    positions,
    emptyTitle: members.length ? "No hay estudiantes en esta vista" : "Aún no hay beneficiarios en este grupo",
    emptyText: members.length
      ? "Cambia el filtro para ver a los demás."
      : canManage()
        ? "Usa «Añadir beneficiario» o «Beneficiarios › Importar el listado oficial»."
        : "Cuando coordinación registre los beneficiarios del PAE, aparecerán aquí."
  });
}

function renderList(items, model, options) {
  elements.lunchList.replaceChildren();
  if (!items.length) {
    const empty = createElement("section", "empty-state");
    empty.append(createElement("h3", "", options.emptyTitle));
    empty.append(createElement("p", "", options.emptyText));
    elements.lunchList.append(empty);
    return;
  }
  items.forEach((item) => {
    const position = item.beneficiary && options.positions ? options.positions.get(item.beneficiary.matricula) : 0;
    elements.lunchList.append(renderRow(item, model, { showGroup: options.showGroup, position }));
  });
}

function render() {
  if (!state.authUser) return;
  const model = buildModel();
  state.dayStateShown = state.day + "|" + model.dState + "|" + model.today;
  renderDayBar(model);
  renderWarning();
  renderGroupPicker(model);
  renderGroup(model);
}

/* ---------- Marcar y quitar almuerzos ---------- */

async function markLunch(beneficiary) {
  if (!isActiveStaff(state.profile) || !beneficiary) return;
  const day = state.day;
  const now = serverNow();
  const today = todayKey(now);
  if (day > today) return;
  if (day !== today && !canManage()) {
    showToast("Sólo directivos y administradores corrigen días anteriores.", { error: true });
    return;
  }
  const ficha = state.rawBeneficiaries[beneficiary.key];
  if (!ficha || typeof ficha !== "object") {
    showToast(beneficiary.nombre + " ya no está en la lista del PAE.", { error: true });
    return;
  }
  if (!GROUPS.includes(ficha.grupo)) {
    showToast("El grupo de la ficha de " + beneficiary.nombre + " no es válido. Corrígelo en «Editar» antes de marcar.", { error: true });
    return;
  }
  const off = noClassPeriodFor(state.noClass, day, ficha.grupo);
  if (off) {
    showToast("Sin clases (" + off.motivo + "): no se registran almuerzos.", { error: true });
    return;
  }
  const existing = state.dayRecords.get(beneficiary.matricula);
  if (existing) {
    showToast(beneficiary.nombre + " ya almorzó (" + clockLabel(existing.hora) + ", " + (existing.via === "manual" ? "a mano" : "chip") + ").");
    return;
  }
  const pendingKey = day + "|" + beneficiary.matricula;
  if (state.pending.has(pendingKey)) return;

  const parts = bogotaParts(now);
  // Nombre y grupo idénticos a la ficha: las reglas lo exigen para aceptar el registro.
  const record = {
    matricula: beneficiary.key,
    nombre: ficha.nombre,
    grupo: ficha.grupo,
    fecha: day,
    hora: timeOfDay(parts.hour * 3600 + parts.minute * 60 + parts.second),
    timestamp: now,
    via: "manual",
    manual: {
      porUid: state.authUser.uid,
      porNombre: state.profile.nombre,
      motivo: day !== today ? "correccion" : beneficiary.chip ? "sin-chip" : "sin-asignar",
      registradoEn: serverTimestamp()
    }
  };
  const sessionId = state.sessionId;
  state.pending.add(pendingKey);
  render();
  showToast("✓ " + beneficiary.nombre + " · asistió al almuerzo", { undo: () => undoLunch(day, beneficiary) });
  try {
    await set(ref(database, "pae/asistencia/" + day + "/" + beneficiary.key), record);
  } catch (error) {
    if (sessionId !== state.sessionId) return;
    console.error("No fue posible registrar el almuerzo", error);
    showToast(error && error.code === "PERMISSION_DENIED"
      ? "Firebase no aceptó el almuerzo de " + beneficiary.nombre + ". Puede que ya esté registrado o que falte publicar las reglas."
      : "No se pudo registrar el almuerzo de " + beneficiary.nombre + ". Revisa Internet.", { error: true });
  } finally {
    state.pending.delete(pendingKey);
    if (sessionId === state.sessionId) render();
  }
}

async function undoLunch(day, beneficiary) {
  hideToast();
  try {
    await remove(ref(database, "pae/asistencia/" + day + "/" + beneficiary.key));
    showToast("Se quitó el almuerzo de " + beneficiary.nombre + ".");
  } catch (error) {
    console.error("No fue posible deshacer el almuerzo", error);
    showToast("No se pudo deshacer. Usa «Quitar» en la fila de " + beneficiary.nombre + ".", { error: true });
  }
}

async function removeLunch(beneficiary, record) {
  if (!canRemove(record)) return;
  const own = record.via === "manual" && record.porUid === state.authUser.uid;
  if (!own) {
    const how = record.via === "manual" ? "registrado a mano por " + (record.porNombre || "otra persona") : "registrado con el chip";
    if (!window.confirm("¿Quitar el almuerzo de " + beneficiary.nombre + " del " + shortDayLabel(state.day) + " (" + how + ")?")) return;
  }
  try {
    await remove(ref(database, "pae/asistencia/" + state.day + "/" + beneficiary.key));
    showToast("Se quitó el almuerzo de " + beneficiary.nombre + ".");
  } catch (error) {
    console.error("No fue posible quitar el almuerzo", error);
    showToast("No se pudo quitar el almuerzo. Inténtalo de nuevo.", { error: true });
  }
}

/* ---------- Beneficiarios (directivo y administrador) ---------- */

function populateGroupSelects() {
  [elements.beneficiaryGroupInput, elements.importGroupInput].forEach((select) => {
    select.replaceChildren();
    GROUPS.forEach((group) => select.append(new Option("Grupo " + group, group)));
  });
}

function openBeneficiaryDialog(beneficiary) {
  if (!canManage()) return;
  const editing = beneficiary || null;
  state.editing = editing ? editing.key : null;
  elements.beneficiaryForm.reset();
  showFormError(elements.beneficiaryError, "");
  elements.beneficiaryDialogTitle.textContent = editing ? "Editar beneficiario" : "Añadir beneficiario";
  elements.beneficiaryMatriculaInput.readOnly = Boolean(editing);
  elements.removeBeneficiaryButton.hidden = !editing;
  if (editing) {
    elements.beneficiaryMatriculaInput.value = editing.matricula;
    elements.beneficiaryNameInput.value = editing.nombre;
    elements.beneficiaryGroupInput.value = GROUPS.includes(editing.grupo) ? editing.grupo : state.activeGroup;
    elements.beneficiaryEstadoInput.value = editing.estado;
    elements.beneficiaryDesdeInput.value = editing.desde;
    elements.beneficiaryChipInput.value = editing.chip;
    elements.beneficiaryHint.textContent = "";
  } else {
    elements.beneficiaryGroupInput.value = state.activeGroup;
    elements.beneficiaryEstadoInput.value = DEFAULT_ESTADO;
    elements.beneficiaryDesdeInput.value = todayKey(serverNow());
    elements.beneficiaryHint.textContent = "En la planilla no saldrá como ausente los días anteriores a «Recibe almuerzo desde».";
  }
  openDialog(elements.beneficiaryDialog);
  (editing ? elements.beneficiaryNameInput : elements.beneficiaryMatriculaInput).focus();
}

function onBeneficiaryGroupChange() {
  const original = state.editing ? state.rawBeneficiaries[state.editing] : null;
  if (!original) return;
  if (normalizeGroup(original.grupo) !== elements.beneficiaryGroupInput.value) {
    elements.beneficiaryDesdeInput.value = todayKey(serverNow());
    elements.beneficiaryHint.textContent = "Al cambiar de grupo, «Recibe almuerzo desde» pasa a hoy: en la planilla del nuevo grupo " +
      "no saldrá como ausente los días anteriores, y sus almuerzos pasados siguen en la planilla del grupo anterior.";
  } else {
    elements.beneficiaryDesdeInput.value = text(original.desde);
    elements.beneficiaryHint.textContent = "";
  }
}

async function saveBeneficiary(event) {
  event.preventDefault();
  if (!canManage()) return;
  const editingKey = state.editing;
  const matricula = editingKey || normalizeMatricula(elements.beneficiaryMatriculaInput.value);
  const nombre = cleanName(elements.beneficiaryNameInput.value);
  const grupo = normalizeGroup(elements.beneficiaryGroupInput.value);
  const estado = cleanName(elements.beneficiaryEstadoInput.value).toUpperCase() || DEFAULT_ESTADO;
  const desde = elements.beneficiaryDesdeInput.value;
  const chipText = text(elements.beneficiaryChipInput.value);
  const chip = normalizeUid(chipText);

  if (!matricula) return showFormError(elements.beneficiaryError, "Escribe la matrícula (sólo números, letras o guiones; máximo 20).");
  if (!nombre) return showFormError(elements.beneficiaryError, "Escribe el nombre del estudiante.");
  if (!GROUPS.includes(grupo)) return showFormError(elements.beneficiaryError, "Elige uno de los grupos de 6.1 a 11.3.");
  if (estado.length > 40) return showFormError(elements.beneficiaryError, "El estado puede tener máximo 40 caracteres.");
  if (desde && !isDayKey(desde)) return showFormError(elements.beneficiaryError, "La fecha «Recibe almuerzo desde» no es válida.");
  if (chipText && !chip) {
    return showFormError(elements.beneficiaryError, "El código del chip debe tener entre 4 y 32 caracteres hexadecimales (0-9 y A-F), sin espacios.");
  }
  const existing = state.rawBeneficiaries[matricula];
  if (!editingKey && existing) {
    return showFormError(elements.beneficiaryError, "Ya existe la matrícula " + matricula + " (" + text(existing.nombre) + ", grupo " + text(existing.grupo) + "). Búscala y usa «Editar».");
  }
  const owner = chip ? text(state.chips[chip]) : "";
  if (owner && owner !== matricula) {
    const other = state.rawBeneficiaries[owner];
    return showFormError(elements.beneficiaryError, "Ese chip ya está vinculado a " + (other ? text(other.nombre) : "la matrícula " + owner) + ".");
  }

  const previous = editingKey ? state.rawBeneficiaries[editingKey] : null;
  const sameGroup = previous && normalizeGroup(previous.grupo) === grupo && Number.isFinite(Number(previous.orden));
  const orden = sameGroup ? Number(previous.orden) : nextOrder(state.beneficiaries.filter((item) => item.key !== matricula), grupo);
  const data = { matricula, nombre, grupo, estado, orden };
  if (desde) data.desde = desde;
  if (chip) data.chip = chip;
  const changes = { ["pae/beneficiarios/" + matricula]: data };
  const oldChip = previous ? normalizeUid(previous.chip) : "";
  if (oldChip && oldChip !== chip) changes["pae/chips/" + oldChip] = null;
  if (chip && chip !== oldChip) changes["pae/chips/" + chip] = matricula;

  elements.saveBeneficiaryButton.disabled = true;
  showFormError(elements.beneficiaryError, "");
  try {
    await update(ref(database), changes);
    if (!editingKey) state.activeGroup = grupo;
    closeDialog(elements.beneficiaryDialog);
    showToast(editingKey ? "Datos de " + nombre + " actualizados." : nombre + " quedó en el PAE del grupo " + grupo + ".");
  } catch (error) {
    console.error("No fue posible guardar el beneficiario", error);
    showFormError(elements.beneficiaryError, "No se pudo guardar. Verifica que tu rol sea Directivo o Administrador y que las reglas de Firebase estén publicadas.");
  } finally {
    elements.saveBeneficiaryButton.disabled = false;
  }
}

async function removeBeneficiary() {
  const key = state.editing;
  const previous = key ? state.rawBeneficiaries[key] : null;
  if (!canManage() || !previous) return;
  if (!window.confirm("¿Quitar a " + text(previous.nombre) + " de la lista del PAE? Sus almuerzos ya registrados se conservan en los informes.")) return;
  const changes = { ["pae/beneficiarios/" + key]: null };
  const chip = normalizeUid(previous.chip);
  if (chip) changes["pae/chips/" + chip] = null;
  elements.removeBeneficiaryButton.disabled = true;
  try {
    await update(ref(database), changes);
    closeDialog(elements.beneficiaryDialog);
    showToast(text(previous.nombre) + " salió de la lista del PAE.");
  } catch (error) {
    console.error("No fue posible quitar el beneficiario", error);
    showFormError(elements.beneficiaryError, "No se pudo quitar. Inténtalo de nuevo.");
  } finally {
    elements.removeBeneficiaryButton.disabled = false;
  }
}

/* ---------- Importar el listado oficial ---------- */

function openManageDialog() {
  if (!canManage()) return;
  elements.importGroupInput.value = state.activeGroup;
  fillCierreInput();
  elements.cierreStatus.textContent = "";
  renderImportPreview();
  openDialog(elements.manageDialog);
}

function renderImportPreview() {
  const { rows, errors } = parseRoster(elements.importText.value, elements.importGroupInput.value);
  state.importRows = rows;
  const fresh = rows.filter((row) => !state.rawBeneficiaries[row.matricula]).length;
  const moved = rows.filter((row) => {
    const previous = state.rawBeneficiaries[row.matricula];
    return previous && normalizeGroup(previous.grupo) !== row.grupo;
  }).length;
  const groups = [...new Set(rows.map((row) => row.grupo))].sort(compareGroups);
  elements.importSummary.textContent = rows.length
    ? plural(rows.length, "estudiante listo", "estudiantes listos") + " para " +
      (groups.length === 1 ? "el grupo " + groups[0] : "los grupos " + groups.join(", ")) + ": " +
      plural(fresh, "nuevo", "nuevos") + ", " + plural(rows.length - fresh, "se actualiza", "se actualizan") +
      (moved ? " (" + plural(moved, "cambia", "cambian") + " de grupo)" : "") + "."
    : elements.importText.value.trim() ? "No se reconoció ninguna fila." : "";
  elements.importErrors.replaceChildren();
  errors.slice(0, 8).forEach((error) => elements.importErrors.append(createElement("li", "", error.message)));
  if (errors.length > 8) elements.importErrors.append(createElement("li", "", "… y " + (errors.length - 8) + " líneas más con problemas."));
  elements.importButton.disabled = !rows.length;
}

async function importRoster() {
  if (!canManage() || !state.importRows.length) return;
  const rows = state.importRows;
  const desde = isDayKey(elements.importDesdeInput.value) ? elements.importDesdeInput.value : "";
  const today = todayKey(serverNow());
  const listed = new Set(rows.map((row) => row.matricula));
  const changes = {};
  const groups = [...new Set(rows.map((row) => row.grupo))];
  groups.forEach((group) => {
    const own = rows.filter((row) => row.grupo === group);
    own.forEach((row, index) => {
      const previous = state.rawBeneficiaries[row.matricula];
      const data = { matricula: row.matricula, nombre: row.nombre, grupo: group, estado: row.estado, orden: index + 1 };
      const movedGroup = previous && normalizeGroup(previous.grupo) !== group;
      const keepDesde = previous && isDayKey(previous.desde) && !movedGroup ? text(previous.desde) : "";
      const newDesde = desde || (movedGroup ? today : keepDesde);
      if (newDesde) data.desde = newDesde;
      const chip = previous ? normalizeUid(previous.chip) : "";
      if (chip) data.chip = chip;
      changes["pae/beneficiarios/" + row.matricula] = data;
    });
    // Quienes ya estaban en el grupo y no vienen en la lista conservan su lugar, al final.
    state.beneficiaries
      .filter((item) => item.grupo === group && !listed.has(item.matricula))
      .sort(compareBeneficiaries)
      .forEach((item, index) => { changes["pae/beneficiarios/" + item.key + "/orden"] = own.length + index + 1; });
  });

  elements.importButton.disabled = true;
  elements.importSummary.textContent = "Importando…";
  try {
    await update(ref(database), changes);
    elements.importText.value = "";
    state.importRows = [];
    elements.importErrors.replaceChildren();
    elements.importSummary.textContent = "Listo: " + plural(rows.length, "estudiante importado", "estudiantes importados") + ".";
    if (groups.length === 1) state.activeGroup = groups[0];
    render();
  } catch (error) {
    console.error("No fue posible importar el listado", error);
    elements.importSummary.textContent = "No se pudo importar. Verifica tu rol y que las reglas de Firebase estén publicadas.";
    elements.importButton.disabled = false;
  }
}

/* ---------- Vincular chips desde las fichas del sistema de llegadas tarde ---------- */

async function searchChipMatches() {
  if (!canManage()) return;
  elements.chipSearchButton.disabled = true;
  elements.chipSummary.textContent = "Buscando en las fichas de estudiantes…";
  elements.chipMatches.replaceChildren();
  elements.chipLinkButton.hidden = true;
  try {
    const snapshot = await get(ref(database, "estudiantes"));
    const result = matchChips(state.beneficiaries, snapshot.val() || {}, state.chips);
    state.chipProposals = result.proposals;
    elements.chipSummary.textContent =
      plural(result.proposals.length, "coincidencia encontrada", "coincidencias encontradas") + " · " +
      plural(result.yaTienenChip, "beneficiario ya tiene", "beneficiarios ya tienen") + " chip · " +
      plural(result.sinCoincidencia, "sin coincidencia", "sin coincidencia") +
      (result.ambiguos ? " · " + plural(result.ambiguos, "con varias tarjetas posibles", "con varias tarjetas posibles") + " (vincúlalos a mano)" : "") + ".";
    result.proposals.forEach((proposal, index) => {
      const item = createElement("li", "chip-match" + (proposal.kind === "parcial" ? " is-partial" : ""));
      const label = createElement("label", "checkbox-field");
      const input = createElement("input");
      input.type = "checkbox";
      input.checked = proposal.kind === "exacta";
      input.dataset.index = String(index);
      const copy = createElement("span", "chip-match-copy");
      copy.append(createElement("strong", "", proposal.nombre + " (" + proposal.grupo + ")"));
      copy.append(createElement(
        "small",
        "",
        "Tarjeta «" + proposal.nombreTarjeta + "» (" + (proposal.grupoTarjeta || "sin grupo") + ") · chip " + proposal.chip +
          (proposal.kind === "parcial" ? " · coincidencia parcial, revísala" : "") +
          (proposal.grupoTarjeta && proposal.grupoTarjeta !== proposal.grupo ? " · otro grupo" : "")
      ));
      label.append(input, copy);
      item.append(label);
      elements.chipMatches.append(item);
    });
    elements.chipLinkButton.hidden = !result.proposals.length;
  } catch (error) {
    console.error("No fue posible leer las fichas de estudiantes", error);
    elements.chipSummary.textContent = "No se pudieron leer las fichas de estudiantes. Revisa Internet y tu rol.";
  } finally {
    elements.chipSearchButton.disabled = false;
  }
}

async function linkSelectedChips() {
  if (!canManage()) return;
  const selected = [...elements.chipMatches.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => state.chipProposals[Number(input.dataset.index)])
    .filter((proposal) => proposal && state.rawBeneficiaries[proposal.matricula] && !state.chips[proposal.chip]);
  if (!selected.length) {
    elements.chipSummary.textContent = "Marca al menos una coincidencia.";
    return;
  }
  const changes = {};
  selected.forEach((proposal) => {
    changes["pae/beneficiarios/" + proposal.matricula + "/chip"] = proposal.chip;
    changes["pae/chips/" + proposal.chip] = proposal.matricula;
  });
  elements.chipLinkButton.disabled = true;
  try {
    await update(ref(database), changes);
    elements.chipMatches.replaceChildren();
    elements.chipLinkButton.hidden = true;
    state.chipProposals = [];
    elements.chipSummary.textContent = "Listo: " + plural(selected.length, "chip vinculado", "chips vinculados") + ".";
  } catch (error) {
    console.error("No fue posible vincular los chips", error);
    elements.chipSummary.textContent = "No se pudieron vincular. Puede que algún chip ya esté en uso; vuelve a buscar.";
  } finally {
    elements.chipLinkButton.disabled = false;
  }
}

/* ---------- Hora de cierre del almuerzo ---------- */

function fillCierreInput() {
  elements.cierreInput.value = text(state.cierre).slice(0, 5);
}

async function saveCierre(event) {
  event.preventDefault();
  if (!canManage()) return;
  const seconds = secondsOfDay(elements.cierreInput.value);
  if (seconds === null) {
    elements.cierreStatus.textContent = "Escribe una hora válida.";
    return;
  }
  elements.cierreSave.disabled = true;
  try {
    await set(ref(database, "pae/config/cierre"), timeOfDay(seconds));
    elements.cierreStatus.textContent = "Guardado: el almuerzo cierra a las " + clockLabel(timeOfDay(seconds)) + ".";
  } catch (error) {
    console.error("No fue posible guardar la hora de cierre", error);
    elements.cierreStatus.textContent = "No se pudo guardar. Verifica tu rol y las reglas de Firebase.";
  } finally {
    elements.cierreSave.disabled = false;
  }
}

/* ---------- Días sin clases ---------- */

// "Todos los grupos", "Grupo 6.1" o "Grupos: Sexto completo, 7.2".
function groupsLabel(groups) {
  if (!groups) return "Todos los grupos";
  if (groups.length === 1) return "Grupo " + groups[0];
  const parts = [];
  GRADES.forEach(({ grade, label }) => {
    const own = [1, 2, 3].map((section) => grade + "." + section).filter((group) => groups.includes(group));
    if (own.length === 3) parts.push(label + " completo");
    else parts.push(...own);
  });
  return "Grupos: " + parts.join(", ");
}

function buildCalendarGroupPicker() {
  elements.calendarGroups.replaceChildren();
  GRADES.forEach(({ grade, label }) => {
    const row = createElement("div", "calendar-grade");
    const all = createElement("label", "check-chip grade-all");
    const allInput = createElement("input");
    allInput.type = "checkbox";
    allInput.dataset.grade = String(grade);
    allInput.setAttribute("aria-label", "Todo " + label);
    all.append(allInput, createElement("span", "", label));
    row.append(all);
    for (let section = 1; section <= 3; section += 1) {
      const group = grade + "." + section;
      const chip = createElement("label", "check-chip");
      const input = createElement("input");
      input.type = "checkbox";
      input.value = group;
      input.dataset.gradeOf = String(grade);
      chip.append(input, createElement("span", "", group));
      row.append(chip);
    }
    elements.calendarGroups.append(row);
  });
  elements.calendarGroups.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.grade) {
      elements.calendarGroups.querySelectorAll("input[data-grade-of='" + input.dataset.grade + "']")
        .forEach((box) => { box.checked = input.checked; });
    }
    syncGradeChecks();
    showCalendarError("");
  });
}

function syncGradeChecks() {
  elements.calendarGroups.querySelectorAll("input[data-grade]").forEach((gradeBox) => {
    const boxes = [...elements.calendarGroups.querySelectorAll("input[data-grade-of='" + gradeBox.dataset.grade + "']")];
    const checked = boxes.filter((box) => box.checked).length;
    gradeBox.checked = checked === boxes.length;
    gradeBox.indeterminate = checked > 0 && checked < boxes.length;
  });
}

function calendarScope() {
  const checked = elements.calendarScopeInputs.find((input) => input.checked);
  return checked ? checked.value : "todos";
}

function selectedCalendarGroups() {
  return [...elements.calendarGroups.querySelectorAll("input[data-grade-of]:checked")].map((input) => input.value);
}

function resetCalendarGroups() {
  elements.calendarScopeInputs.forEach((input) => { input.checked = input.value === "todos"; });
  elements.calendarGroups.querySelectorAll("input").forEach((input) => {
    input.checked = false;
    input.indeterminate = false;
  });
  elements.calendarGroups.hidden = true;
}

// "Del lun 12 al vie 16 de oct de 2026", "Del lun 28 de sep al vie 2 de oct de 2026" o "jue 1 de oct de 2026".
function periodLabel(period) {
  const year = (day) => day.slice(0, 4);
  if (period.desde === period.hasta) return shortDayLabel(period.desde) + " de " + year(period.desde);
  const sameYear = year(period.desde) === year(period.hasta);
  const sameMonth = sameYear && monthKeyOf(period.desde) === monthKeyOf(period.hasta);
  const start = sameMonth
    ? shortDayLabel(period.desde).replace(/ de [a-z]+$/, "")
    : shortDayLabel(period.desde) + (sameYear ? "" : " de " + year(period.desde));
  return "Del " + start + " al " + shortDayLabel(period.hasta) + " de " + year(period.hasta);
}

function showCalendarError(message) {
  showFormError(elements.calendarError, message);
}

function openCalendar() {
  if (!state.calendar.month) state.calendar.month = monthKeyOf(todayKey(serverNow()));
  showCalendarError("");
  renderCalendar();
  openDialog(elements.calendarDialog);
}

function moveCalendar(amount) {
  state.calendar.month = shiftMonth(state.calendar.month || monthKeyOf(todayKey(serverNow())), amount);
  renderCalendar();
}

// Primer toque: inicio del rango. Segundo toque: fin (en cualquier orden). Un tercero empieza de nuevo.
function selectCalendarDay(day) {
  if (!canManage()) return;
  const calendar = state.calendar;
  if (!calendar.start || calendar.end) {
    calendar.start = day;
    calendar.end = "";
  } else if (day < calendar.start) {
    calendar.end = calendar.start;
    calendar.start = day;
  } else {
    calendar.end = day;
  }
  calendar.notice = "";
  showCalendarError("");
  renderCalendar();
  const again = [...elements.calendarGrid.children].find((cell) => cell.dataset.day === day);
  if (again) again.focus();
}

function renderCalendar() {
  const calendar = state.calendar;
  const today = todayKey(serverNow());
  const month = calendar.month || monthKeyOf(today);
  const manager = canManage();
  const from = calendar.start;
  const to = calendar.end || calendar.start;

  elements.calendarForm.hidden = !manager;
  elements.calendarMonthLabel.textContent = formatMonth(month);
  elements.calendarGrid.replaceChildren();

  const first = month + "-01";
  const gridStart = addDays(first, -weekdayFromMonday(first));
  for (let index = 0; index < 42; index += 1) {
    const day = addDays(gridStart, index);
    // La sexta fila sólo se dibuja si todavía tiene días del mes.
    if (index === 35 && monthKeyOf(day) !== month) break;
    const periods = noClassPeriodsOn(state.noClass, day);
    const offAll = periods.some((period) => !period.groups);
    const selected = Boolean(from) && day >= from && day <= to;
    const cell = createElement(manager ? "button" : "span", "calendar-day", String(Number(day.slice(8))));
    cell.dataset.day = day;
    if (monthKeyOf(day) !== month) cell.classList.add("outside");
    if (weekdayFromMonday(day) >= 5) cell.classList.add("weekend");
    if (day === today) cell.classList.add("today");
    const offText = periods.map((period) => period.motivo + " (" + groupsLabel(period.groups) + ")").join("; ");
    if (periods.length) {
      cell.classList.add(offAll ? "off" : "off-partial");
      cell.title = offText;
    }
    if (selected) cell.classList.add("selected");
    if (selected && day === from) cell.classList.add("range-start");
    if (selected && day === to) cell.classList.add("range-end");
    const label = formatDayLong(day) + (periods.length ? ", sin clases: " + offText : "") + (day === today ? ", hoy" : "");
    if (manager) {
      cell.type = "button";
      cell.setAttribute("aria-pressed", String(selected));
      cell.setAttribute("aria-label", label);
      cell.addEventListener("click", () => selectCalendarDay(day));
    } else {
      cell.setAttribute("role", "img");
      cell.setAttribute("aria-label", label);
    }
    elements.calendarGrid.append(cell);
  }

  elements.calendarFrom.value = from || "";
  elements.calendarTo.value = from ? to : "";
  if (from) {
    const overlap = state.noClass.some((period) => period.desde <= to && period.hasta >= from);
    elements.calendarSummary.textContent = plural(dayCount(from, to), "día elegido", "días elegidos") + ": " +
      periodLabel({ desde: from, hasta: to }) + (overlap ? ". Incluye días que ya estaban marcados." : ".");
  } else {
    elements.calendarSummary.textContent = calendar.notice || "Aún no has elegido días.";
  }
  renderNoClassList();
}

function renderNoClassList() {
  const today = todayKey(serverNow());
  const list = state.noClass;
  elements.calendarList.replaceChildren();
  if (!list.length) {
    elements.calendarList.append(createElement("li", "calendar-empty", "No hay días sin clases registrados."));
    return;
  }
  // Primero los que están en curso o vienen; después los pasados, del más reciente al más antiguo.
  const upcoming = list.filter((period) => period.hasta >= today);
  const past = list.filter((period) => period.hasta < today).reverse();
  [...upcoming, ...past].forEach((period) => {
    const isPast = period.hasta < today;
    const isNow = period.desde <= today && today <= period.hasta;
    const item = createElement("li", "calendar-item" + (isPast ? " past" : "") + (isNow ? " now" : ""));
    const info = createElement("div", "calendar-item-info");
    info.append(createElement("strong", "", period.motivo));
    info.append(createElement(
      "span",
      "",
      periodLabel(period) + " · " + plural(dayCount(period.desde, period.hasta), "día", "días") +
        (isNow ? " · en curso" : isPast ? " · pasado" : "")
    ));
    info.append(createElement("span", "calendar-item-groups" + (period.groups ? "" : " all"), groupsLabel(period.groups)));
    if (period.source === "panel") info.append(createElement("span", "calendar-item-source", "Marcado en el panel de llegadas tarde"));
    const actions = createElement("div", "calendar-item-actions");
    const show = createElement("button", "small-button", "Ver");
    show.type = "button";
    show.setAttribute("aria-label", "Ver en el calendario: " + period.motivo);
    show.addEventListener("click", () => {
      state.calendar.month = monthKeyOf(period.desde);
      renderCalendar();
    });
    actions.append(show);
    // Los del panel de llegadas tarde se quitan desde ese panel: aquí sólo se consultan.
    if (canManage() && period.source === "pae") {
      const removeButton = createElement("button", "small-button danger", "Quitar");
      removeButton.type = "button";
      removeButton.setAttribute("aria-label", "Quitar " + period.motivo + " (" + periodLabel(period) + ")");
      removeButton.addEventListener("click", () => removeNoClassPeriod(period));
      actions.append(removeButton);
    }
    item.append(info, actions);
    elements.calendarList.append(item);
  });
}

async function saveNoClassPeriod(event) {
  event.preventDefault();
  if (!canManage()) return;
  const desde = state.calendar.start;
  const hasta = state.calendar.end || state.calendar.start;
  const motivo = text(elements.calendarReason.value);
  if (!isDayKey(desde) || !isDayKey(hasta)) {
    showCalendarError("Elige en el calendario el primer y el último día.");
    return;
  }
  if (!motivo) {
    showCalendarError("Escribe el motivo, por ejemplo «Festivo».");
    elements.calendarReason.focus();
    return;
  }
  if (dayCount(desde, hasta) > 120) {
    showCalendarError("Un periodo puede tener máximo 120 días. Divídelo en partes.");
    return;
  }
  const groups = calendarScope() === "todos" ? null : selectedCalendarGroups();
  if (groups && !groups.length) {
    showCalendarError("Marca los grupos que no tienen clase, o elige «Todos los grupos».");
    return;
  }

  elements.calendarSave.disabled = true;
  showCalendarError("");
  try {
    await set(ref(database, "pae/diasSinClases/" + desde + "_" + Date.now().toString(36)), {
      desde,
      hasta,
      motivo,
      grupos: groups ? groups.join(",") : "todos",
      creadoPorUid: state.authUser.uid,
      creadoEn: serverTimestamp()
    });
    state.calendar.start = "";
    state.calendar.end = "";
    state.calendar.notice = "Guardado: " + motivo + " · " + groupsLabel(groups) + " (" + periodLabel({ desde, hasta }) + ").";
    elements.calendarReason.value = "";
    resetCalendarGroups();
    state.reportCache.clear();
    renderCalendar();
  } catch (error) {
    console.error("No fue posible guardar los días sin clases", error);
    showCalendarError("No se pudo guardar. Verifica que tu rol sea Directivo o Administrador y que las reglas de Firebase estén publicadas.");
  } finally {
    elements.calendarSave.disabled = false;
  }
}

async function removeNoClassPeriod(period) {
  if (!canManage() || period.source !== "pae") return;
  const confirmed = window.confirm(
    "¿Quitar «" + period.motivo + "» (" + periodLabel(period) + ")? Esos días volverán a contar almuerzos y ausencias."
  );
  if (!confirmed) return;
  try {
    await remove(ref(database, "pae/diasSinClases/" + period.id));
    showCalendarError("");
  } catch (error) {
    console.error("No fue posible quitar los días sin clases", error);
    showCalendarError("No se pudo quitar. Inténtalo de nuevo.");
  }
}

/* ---------- Informes ---------- */

// Descarga sólo los días del periodo (las claves de pae/asistencia son fechas AAAA-MM-DD).
async function loadAttendanceRange(range, force) {
  const key = range.start + "_" + range.end;
  const cached = state.reportCache.get(key);
  let data;
  if (!force && cached && Date.now() - cached.at < REPORT_CACHE_MS) {
    data = cached.data;
  } else {
    const snapshot = await get(query(ref(database, "pae/asistencia"), orderByKey(), startAt(range.start), endAt(range.end)));
    data = normalizeAttendance(snapshot.val());
    state.reportCache.set(key, { at: Date.now(), data });
  }
  // El día que se ve en pantalla se toma de la escucha en vivo, que siempre está al día.
  if (state.dayLoaded && state.day >= range.start && state.day <= range.end) {
    data = new Map(data);
    if (state.dayRecords.size) data.set(state.day, state.dayRecords);
    else data.delete(state.day);
  }
  return data;
}

function reportContext() {
  const now = serverNow();
  return {
    beneficiaries: state.beneficiaries,
    noClass: state.noClass,
    today: todayKey(now),
    nowSeconds: secondsNow(now),
    cierreSeconds: cierreSeconds(state.cierre)
  };
}

function exportReport(report, filters, jornada) {
  return exportToXlsx(report, filters, {
    jornada,
    cierreLabel: clockLabel(state.cierre),
    groupLabel: filters.group ? "Grupo " + filters.group : "Todos los grupos con beneficiarios",
    generatedBy: (text(state.profile && state.profile.nombre) || text(state.authUser && state.authUser.email) || "Usuario") +
      " (" + roleLabel(text(state.profile && state.profile.rol)) + ")"
  });
}

const statsView = createStatsView({
  getContext: reportContext,
  loadAttendance: loadAttendanceRange,
  onExport: (report, filters, extra) => exportReport(report, filters, extra.jornada)
});

// Un clic: descarga de inmediato la planilla del mes del grupo que se está viendo, sin abrir
// «Informes y Excel». Es la misma planilla del informe (mismo formato del listado del colegio).
async function downloadGroupExcel() {
  if (!isActiveStaff(state.profile)) return;
  const group = state.activeGroup;
  const button = elements.groupExcelButton;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Preparando Excel…";
  try {
    const range = periodRange({ type: "mes" }, serverNow());
    const attendance = await loadAttendanceRange(range, false);
    const report = runReport(range, { group }, { ...reportContext(), attendance });
    const fileName = await exportReport(report, { group }, savedJornada());
    showToast("Descargado: " + fileName);
  } catch (error) {
    console.error("No fue posible descargar la planilla del grupo", error);
    showToast("No se pudo generar el Excel. Revisa tu conexión e inténtalo de nuevo.", { error: true });
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------- Eventos ---------- */

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showLoginError("");
  elements.loginButton.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, text(elements.emailInput.value), elements.passwordInput.value);
  } catch (error) {
    console.error("No fue posible iniciar sesión", error);
    showLoginError(loginErrorMessage(error));
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("No fue posible cerrar sesión", error);
  }
});

elements.searchInput.addEventListener("input", (event) => {
  state.search = text(event.target.value);
  render();
});

// Enter con un solo resultado marca el almuerzo y deja la búsqueda lista para el siguiente.
elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.search) {
    state.search = "";
    elements.searchInput.value = "";
    render();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!searchText(state.search)) return;
  const model = buildModel();
  const matches = searchMatches(model);
  if (matches.length !== 1) {
    showToast(matches.length
      ? "Hay " + matches.length + " coincidencias: escribe un poco más o toca al estudiante."
      : "No hay coincidencias con «" + state.search + "».", { error: !matches.length });
    return;
  }
  const item = matches[0];
  state.search = "";
  elements.searchInput.value = "";
  if (item.record) {
    showToast(item.beneficiary.nombre + " ya almorzó (" + clockLabel(item.record.hora) + ").");
    render();
    return;
  }
  if (!canMark(item, model)) {
    showToast(item.noClass ? "Sin clases (" + item.noClass.motivo + "): no se registran almuerzos." : "No se puede marcar en este momento.", { error: true });
    render();
    return;
  }
  markLunch(item.beneficiary);
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || elements.appView.hidden) return;
  const target = event.target;
  if (target && (target.closest("input, textarea, select, [contenteditable]") || target.closest("dialog[open]"))) return;
  event.preventDefault();
  elements.searchInput.focus();
});

elements.listFilterInputs.forEach((input) => {
  input.addEventListener("change", () => {
    state.listFilter = input.value;
    render();
  });
});
elements.toastUndo.addEventListener("click", () => {
  const undo = toastUndo;
  hideToast();
  if (undo) undo();
});

elements.dayInput.addEventListener("change", () => goToDay(elements.dayInput.value));
elements.dayPrev.addEventListener("click", () => goToDay(addDays(state.day, -1)));
elements.dayNext.addEventListener("click", () => goToDay(addDays(state.day, 1)));
elements.dayToday.addEventListener("click", () => goToDay(todayKey(serverNow())));

elements.addBeneficiaryButton.addEventListener("click", () => openBeneficiaryDialog(null));
elements.beneficiaryForm.addEventListener("submit", saveBeneficiary);
elements.beneficiaryGroupInput.addEventListener("change", onBeneficiaryGroupChange);
elements.removeBeneficiaryButton.addEventListener("click", removeBeneficiary);
elements.beneficiaryDialog.addEventListener("close", () => { state.editing = null; });

elements.manageButton.addEventListener("click", openManageDialog);
elements.importText.addEventListener("input", renderImportPreview);
elements.importGroupInput.addEventListener("change", renderImportPreview);
elements.importButton.addEventListener("click", importRoster);
elements.chipSearchButton.addEventListener("click", searchChipMatches);
elements.chipLinkButton.addEventListener("click", linkSelectedChips);
elements.cierreForm.addEventListener("submit", saveCierre);

elements.statsButton.addEventListener("click", () => {
  if (isActiveStaff(state.profile)) statsView.open();
});
elements.groupExcelButton.addEventListener("click", downloadGroupExcel);

elements.calendarButton.addEventListener("click", () => {
  if (isActiveStaff(state.profile)) openCalendar();
});
elements.calendarPrev.addEventListener("click", () => moveCalendar(-1));
elements.calendarNext.addEventListener("click", () => moveCalendar(1));
elements.calendarForm.addEventListener("submit", saveNoClassPeriod);
elements.calendarScopeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    elements.calendarGroups.hidden = calendarScope() === "todos";
    showCalendarError("");
  });
});
buildCalendarGroupPicker();
elements.calendarClear.addEventListener("click", () => {
  state.calendar.start = "";
  state.calendar.end = "";
  state.calendar.notice = "";
  resetCalendarGroups();
  elements.calendarReason.value = "";
  showCalendarError("");
  renderCalendar();
});
[elements.calendarFrom, elements.calendarTo].forEach((input) => {
  input.addEventListener("change", () => {
    const from = isDayKey(elements.calendarFrom.value) ? elements.calendarFrom.value : "";
    const to = isDayKey(elements.calendarTo.value) ? elements.calendarTo.value : "";
    state.calendar.start = from && to && to < from ? to : from || to;
    state.calendar.end = from && to ? (to < from ? from : to) : "";
    if (state.calendar.start) state.calendar.month = monthKeyOf(state.calendar.start);
    renderCalendar();
  });
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = document.querySelector("#" + button.dataset.closeDialog);
    if (dialog) closeDialog(dialog);
  });
});

populateGroupSelects();

// Sesión sólo en la pestaña actual: al cerrar el navegador hay que volver a iniciar sesión.
setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.warn("No se pudo configurar la persistencia de sesión", error);
});

/* ---------- Reloj: cambio de día y hora de cierre del almuerzo ---------- */

setInterval(() => {
  if (!state.authUser) return;
  const now = serverNow();
  const today = todayKey(now);
  if (state.followToday && state.day !== today) {
    subscribeDay(today);
    return;
  }
  // Sólo se vuelve a pintar si cambió algo visible (por ejemplo, pasó la hora de cierre).
  const shown = state.day + "|" + (state.dayLoaded
    ? dayState(state.day, { today, nowSeconds: secondsNow(now), cierreSeconds: cierreSeconds(state.cierre), attendance: new Map([[state.day, state.dayRecords]]) })
    : "en-curso") + "|" + today;
  if (shown !== state.dayStateShown) render();
}, CLOCK_TICK_MS);

/* ---------- Temporizador de inactividad (25 min) ---------- */

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!state.authUser) return;
  inactivityTimer = setTimeout(async () => {
    if (state.authUser) {
      window.alert("Tu sesión se cerró por inactividad (25 minutos). Vuelve a iniciar sesión.");
      try { await signOut(auth); } catch (_) { /* se ignora */ }
    }
  }, INACTIVITY_TIMEOUT_MS);
}

["click", "keydown", "scroll", "touchstart", "mousemove"].forEach((type) => {
  document.addEventListener(type, resetInactivityTimer, { passive: true });
});

onAuthStateChanged(auth, async (user) => {
  const sessionId = state.sessionId + 1;
  state.sessionId = sessionId;
  detachDatabaseListeners();
  state.authUser = null;
  state.profile = null;
  state.rawBeneficiaries = {};
  state.beneficiaries = [];
  state.chips = {};
  state.dayRecords = new Map();
  state.dayLoaded = false;
  state.ownNoClass = {};
  state.sharedNoClass = {};
  state.noClass = [];
  state.cierre = DEFAULT_CIERRE;
  state.pending.clear();
  state.reportCache.clear();
  state.editing = null;
  state.importRows = [];
  state.chipProposals = [];
  state.day = todayKey();
  state.followToday = true;

  if (inactivityTimer) clearTimeout(inactivityTimer);

  if (!user) {
    showLogin();
    return;
  }

  showLoginError("");
  elements.loginButton.disabled = true;
  try {
    const profileSnapshot = await get(ref(database, "usuarios/" + user.uid));
    if (sessionId !== state.sessionId) return;

    const profile = profileSnapshot.val();
    if (!isActiveStaff(profile)) {
      showLoginError(
        "Tu cuenta no tiene un perfil activo con rol docente, directivo o administrador. Pide a administración que la habilite."
      );
      await signOut(auth);
      return;
    }

    state.authUser = user;
    state.profile = profile;
    showApp();
    render();
    setStatus("Conectando actualizaciones en vivo…", false);
    subscribeToData();
    watchProfile(user.uid);
    resetInactivityTimer();
  } catch (error) {
    if (sessionId !== state.sessionId) return;
    console.error("No fue posible cargar el perfil del usuario", error);
    showLoginError(profileErrorMessage(error));
    await signOut(auth);
  } finally {
    if (sessionId === state.sessionId) elements.loginButton.disabled = false;
  }
});
