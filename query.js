/*
 * Lógica única de la asistencia al almuerzo del PAE (modalidad Comida Caliente Transportada, CCT).
 *
 * La pantalla «Hoy», la vista de informes y la planilla de Excel usan exclusivamente estas
 * funciones; por eso nunca pueden dar cifras distintas. El módulo es puro (no toca el DOM ni
 * Firebase) y se prueba con `node --test` desde la carpeta tests.
 *
 * Fechas: el día de cada almuerzo es la clave AAAA-MM-DD de pae/asistencia, calculada con la hora
 * de Colombia (America/Bogota) por el lector y por el panel. "Hoy", semana (lunes a domingo) y mes
 * se calculan en America/Bogota con Intl, sin depender de la zona horaria del navegador.
 *
 * Regla de la asistencia de cada beneficiario en cada día:
 *   - Con registro (chip o manual)                     → asistió al almuerzo (✓).
 *   - Sin registro, en un día de servicio ya cerrado   → no asistió al almuerzo (X).
 * Un día está cerrado cuando ya pasó o, si es hoy, cuando pasó la hora de cierre del almuerzo.
 * No se marca a nadie como «no asistió» en los días sin clases de su grupo, en los días que nadie
 * del colegio registró almuerzo (no hubo servicio) ni antes de la fecha en que entró al PAE.
 */

export const TIME_ZONE = "America/Bogota";

export const GRADES = [
  { grade: 6, label: "Sexto" },
  { grade: 7, label: "Séptimo" },
  { grade: 8, label: "Octavo" },
  { grade: 9, label: "Noveno" },
  { grade: 10, label: "Décimo" },
  { grade: 11, label: "Undécimo" }
];

export const GROUPS = [];
GRADES.forEach(({ grade }) => {
  for (let section = 1; section <= 3; section += 1) {
    GROUPS.push(String(grade) + "." + String(section));
  }
});

export const NO_GROUP = "Sin grupo";
export const DEFAULT_ESTADO = "ALMUERZO";
// Hora a partir de la cual quien no tiene registro de hoy queda como «no asistió al almuerzo».
export const DEFAULT_CIERRE = "14:00:00";
export const MAX_RANGE_DAYS = 62;

// Por qué un almuerzo se registró a mano en el panel y no con el chip.
// Las mismas claves están en database.rules.json (pae/asistencia/$fecha/$matricula/manual/motivo).
export const MANUAL_REASON_LABELS = {
  "sin-chip": "No trajo el chip",
  "sin-asignar": "No tiene chip asignado",
  correccion: "Corrección posterior"
};

export const PERIOD_TYPES = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
  dia: "Un día específico",
  "semana-de": "Una semana específica",
  "mes-de": "Un mes específico",
  rango: "Rango de fechas"
};

// Estado de cada casilla de la planilla.
export const CELL = {
  ASISTIO: "asistio",
  NO_ASISTIO: "no-asistio",
  PENDIENTE: "pendiente",
  FUTURO: "futuro",
  NO_APLICA: "no-aplica",
  SIN_CLASES: "sin-clases",
  SIN_SERVICIO: "sin-servicio"
};

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const MS_PER_DAY = 86400000;

const bogotaFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

// Los nombres de días y meses se formatean sobre fechas UTC "abstractas" para
// que el navegador no desplace el día según su zona horaria.
const longDayFormatter = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});
const shortDayFormatter = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric"
});
const monthNameFormatter = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  month: "long",
  year: "numeric"
});
const nameCollator = new Intl.Collator("es-CO", { numeric: true, sensitivity: "base" });

export function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function plural(count, singular, pluralForm) {
  return String(count) + " " + (count === 1 ? singular : pluralForm);
}

// Permite buscar sin preocuparse por mayúsculas, espacios o tildes.
export function searchText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es-CO");
}

export function uidKey(value) {
  return text(value).replace(/[:\s-]/g, "").toUpperCase();
}

// UID del chip: hexadecimal en mayúsculas, sin espacios ni dos puntos (igual que el lector).
export function normalizeUid(value) {
  const uid = uidKey(value);
  return /^[0-9A-F]{4,32}$/.test(uid) ? uid : "";
}

// Matrícula del listado oficial (por ejemplo 241081). También es la clave en Firebase.
export function normalizeMatricula(value) {
  const matricula = text(value).replace(/\s+/g, "").toUpperCase();
  return /^[0-9A-Z-]{1,20}$/.test(matricula) && /[0-9]/.test(matricula) ? matricula : "";
}

// Nombre tal como se escribe, sin espacios repetidos.
export function cleanName(value) {
  return text(value).replace(/\s+/g, " ");
}

export function normalizeGroup(value) {
  const raw = text(value).replace(",", ".").replace(/\s+/g, "");
  const withSeparator = raw.match(/^(6|7|8|9|10|11)\.([1-3])$/);
  if (withSeparator) return withSeparator[1] + "." + withSeparator[2];
  const compact = raw.match(/^(6|7|8|9|10|11)([1-3])$/);
  if (compact) return compact[1] + "." + compact[2];
  return "";
}

// Acepta además los códigos del listado oficial: "060100", "0601", "601" y "6-1".
export function normalizeGroupLoose(value) {
  const direct = normalizeGroup(text(value).replace("-", "."));
  if (direct) return direct;
  const code = text(value).replace(/\s+/g, "").match(/^0?(6|7|8|9|10|11)0([1-3])(00)?$/);
  return code ? code[1] + "." + code[2] : "";
}

// Código del grupo en el «Listado de grupo con número de orden»: 6.1 → "060100", 11.3 → "110300".
export function groupCode(group) {
  const match = text(group).match(/^(\d{1,2})\.(\d)$/);
  return match ? pad(match[1]) + pad(match[2]) + "00" : "";
}

export function compareGroups(first, second) {
  const firstIndex = GROUPS.indexOf(first);
  const secondIndex = GROUPS.indexOf(second);
  return (firstIndex === -1 ? GROUPS.length : firstIndex) - (secondIndex === -1 ? GROUPS.length : secondIndex);
}

// Clave para comparar nombres escritos de forma distinta: sin tildes, en mayúsculas y con las
// palabras ordenadas («Andrea Álvarez Curequia» = «ALVAREZ CUREQUIA ANDREA»).
export function nameTokens(value) {
  return searchText(value)
    .toUpperCase()
    .replace(/[^A-ZÑ ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function nameKey(value) {
  return nameTokens(value).sort().join(" ");
}

/* ---------- Fechas y horas en America/Bogota ---------- */

export function bogotaParts(milliseconds) {
  const parts = {};
  bogotaFormatter.formatToParts(new Date(milliseconds)).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  });
  return parts;
}

export function todayKey(nowMs) {
  const parts = bogotaParts(nowMs === undefined ? Date.now() : nowMs);
  return makeDayKey(parts.year, parts.month, parts.day);
}

// Segundos transcurridos del día en Colombia.
export function secondsNow(nowMs) {
  const parts = bogotaParts(nowMs === undefined ? Date.now() : nowMs);
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
}

export function makeDayKey(year, month, day) {
  return String(year) + "-" + pad(month) + "-" + pad(day);
}

export function isDayKey(value) {
  const match = text(value).match(DAY_KEY);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dayNumber(key) {
  const match = key.match(DAY_KEY);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

export function keyFromDayNumber(number) {
  const date = new Date(number * MS_PER_DAY);
  return makeDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(key, amount) {
  return keyFromDayNumber(dayNumber(key) + amount);
}

export function dayCount(from, to) {
  return dayNumber(to) - dayNumber(from) + 1;
}

// 0 = lunes … 6 = domingo.
export function weekdayFromMonday(key) {
  return (new Date(dayNumber(key) * MS_PER_DAY).getUTCDay() + 6) % 7;
}

export function isWeekend(key) {
  return weekdayFromMonday(key) >= 5;
}

export function weekStart(key) {
  return addDays(key, -weekdayFromMonday(key));
}

export function monthKeyOf(key) {
  return key.slice(0, 7);
}

export function monthBounds(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: makeDayKey(year, month, 1), end: makeDayKey(year, month, lastDay) };
}

export function shiftMonth(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return String(date.getUTCFullYear()) + "-" + pad(date.getUTCMonth() + 1);
}

function utcDate(key) {
  return new Date(dayNumber(key) * MS_PER_DAY);
}

export function formatDayLong(key) {
  return longDayFormatter.format(utcDate(key));
}

export function formatDayShort(key) {
  return shortDayFormatter.format(utcDate(key)).replace(/\./g, "");
}

export function formatMonth(monthKey) {
  return capitalize(monthNameFormatter.format(utcDate(monthKey + "-01")));
}

// "7:05", "07:05" o "07:05:30" → segundos desde la medianoche; null si no es una hora válida.
export function secondsOfDay(value) {
  const match = text(value).match(TIME_KEY);
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

// 45930 → "12:45:30"
export function timeOfDay(seconds) {
  if (seconds === null || seconds === undefined) return "";
  return pad(Math.floor(seconds / 3600)) + ":" + pad(Math.floor((seconds % 3600) / 60)) + ":" + pad(seconds % 60);
}

// "12:05:30" → "12:05 p. m."
export function clockLabel(time) {
  const match = text(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return String(hour12) + ":" + match[2] + (hours < 12 ? " a. m." : " p. m.");
}

export function cierreSeconds(value) {
  const seconds = secondsOfDay(value);
  return seconds === null ? secondsOfDay(DEFAULT_CIERRE) : seconds;
}

/*
 * Convierte la elección de periodo en un rango cerrado de días [start, end].
 * spec = { type, value } — value es AAAA-MM-DD para "dia" y "semana-de" (cualquier día de esa
 * semana), AAAA-MM para "mes-de" y { from, to } para "rango".
 */
export function periodRange(spec, nowMs) {
  const type = spec && PERIOD_TYPES[spec.type] ? spec.type : "hoy";
  const today = todayKey(nowMs);
  const value = spec ? spec.value : "";

  if (type === "hoy" || type === "dia") {
    const day = type === "dia" && isDayKey(value) ? value : today;
    return { kind: "dia", start: day, end: day, label: capitalize(formatDayLong(day)), fileTag: day };
  }

  if (type === "semana" || type === "semana-de") {
    const anchor = type === "semana-de" && isDayKey(value) ? value : today;
    const start = weekStart(anchor);
    const end = addDays(start, 6);
    return {
      kind: "semana",
      start,
      end,
      label: "Semana del " + formatDayLong(start) + " al " + formatDayLong(end),
      fileTag: start + "_a_" + end
    };
  }

  if (type === "rango") {
    let from = value && isDayKey(value.from) ? value.from : today;
    let to = value && isDayKey(value.to) ? value.to : from;
    if (to < from) [from, to] = [to, from];
    let capped = false;
    if (dayCount(from, to) > MAX_RANGE_DAYS) {
      to = addDays(from, MAX_RANGE_DAYS - 1);
      capped = true;
    }
    return {
      kind: "rango",
      start: from,
      end: to,
      capped,
      label: from === to
        ? capitalize(formatDayLong(from))
        : "Del " + formatDayLong(from) + " al " + formatDayLong(to),
      fileTag: from + "_a_" + to
    };
  }

  let month = monthKeyOf(today);
  if (type === "mes-anterior") month = shiftMonth(month, -1);
  if (type === "mes-de" && /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value))) month = text(value);
  const bounds = monthBounds(month);
  return { kind: "mes", start: bounds.start, end: bounds.end, label: formatMonth(month), fileTag: month };
}

/* Meses para «Un mes específico»: del mes actual hacia atrás, 12 meses. */
export function monthOptions(nowMs) {
  const current = monthKeyOf(todayKey(nowMs));
  const options = [];
  for (let index = 0; index < 12; index += 1) {
    const month = shiftMonth(current, -index);
    options.push({ value: month, label: formatMonth(month) });
  }
  return options;
}

/* ---------- Días sin clases ---------- */

// "todos" (o vacío, en periodos antiguos) = todos los grupos; si no, lista "6.1,7.2".
export function parseNoClassGroups(value) {
  const raw = text(value);
  if (!raw || raw === "todos") return null;
  const groups = [...new Set(raw.split(",").map(normalizeGroup).filter(Boolean))];
  return groups.length ? groups.sort(compareGroups) : null;
}

/*
 * Periodos válidos ordenados por fecha: { id, source, desde, hasta, motivo, groups }.
 * source "pae" = marcados en este panel (pae/diasSinClases); "panel" = marcados en el panel de
 * llegadas tarde (config/diasSinClases), que aquí sólo se consultan.
 */
export function normalizeNoClassPeriods(own, shared) {
  const list = [];
  [["pae", own], ["panel", shared]].forEach(([source, raw]) => {
    Object.entries(raw || {}).forEach(([id, period]) => {
      const item = {
        id,
        source,
        desde: text(period && period.desde),
        hasta: text(period && period.hasta),
        motivo: text(period && period.motivo) || "Sin clases",
        groups: parseNoClassGroups(period && period.grupos)
      };
      if (isDayKey(item.desde) && isDayKey(item.hasta) && item.hasta >= item.desde) list.push(item);
    });
  });
  return list.sort((first, second) => first.desde.localeCompare(second.desde));
}

export function noClassPeriodsOn(list, day) {
  return list.filter((period) => day >= period.desde && day <= period.hasta);
}

// El periodo sin clases de ese día que afecta a ese grupo, o null. Sin grupo sólo cuentan los de todos.
export function noClassPeriodFor(list, day, group) {
  if (!day) return null;
  const target = normalizeGroup(group);
  return noClassPeriodsOn(list, day).find((period) => !period.groups || (target && period.groups.includes(target))) || null;
}

/* ---------- Beneficiarios ---------- */

export function normalizeBeneficiaries(raw) {
  return Object.entries(raw || {})
    .filter((entry) => entry[1] && typeof entry[1] === "object")
    .map(([key, item]) => {
      const nombre = cleanName(item.nombre) || "Sin nombre";
      const matricula = text(item.matricula) || key;
      const orden = Number(item.orden);
      return {
        key,
        matricula,
        nombre,
        rawGroup: text(item.grupo),
        grupo: normalizeGroup(item.grupo),
        estado: text(item.estado) || DEFAULT_ESTADO,
        orden: Number.isFinite(orden) ? orden : Number.MAX_SAFE_INTEGER,
        desde: isDayKey(item.desde) ? text(item.desde) : "",
        chip: normalizeUid(item.chip),
        searchName: searchText(nombre)
      };
    });
}

// Orden del listado oficial («número de orden»); a igual orden, alfabético.
export function compareBeneficiaries(first, second) {
  if (first.orden !== second.orden) return first.orden - second.orden;
  return nameCollator.compare(first.nombre, second.nombre);
}

export function groupMembers(beneficiaries, group) {
  return beneficiaries.filter((item) => item.grupo === group).sort(compareBeneficiaries);
}

export function nextOrder(beneficiaries, group) {
  return beneficiaries
    .filter((item) => item.grupo === group && item.orden !== Number.MAX_SAFE_INTEGER)
    .reduce((highest, item) => Math.max(highest, item.orden), 0) + 1;
}

/* ---------- Registros de almuerzo ---------- */

// "Chip" o "Manual: No trajo el chip (Ana Gómez)".
export function registrationLabel(record) {
  if (!record || record.via !== "manual") return "Chip";
  const reason = MANUAL_REASON_LABELS[record.motivo] || "Sin motivo";
  return "Manual: " + reason + (record.porNombre ? " (" + record.porNombre + ")" : "");
}

function normalizeRecord(matricula, raw, day) {
  if (!raw || typeof raw !== "object") return null;
  const manual = raw.manual && typeof raw.manual === "object" ? raw.manual : null;
  const timestamp = Number(raw.timestamp);
  let seconds = secondsOfDay(raw.hora);
  if (seconds === null && Number.isFinite(timestamp) && timestamp > 0) {
    const parts = bogotaParts(timestamp);
    seconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  }
  const record = {
    matricula: text(raw.matricula) || matricula,
    nombre: cleanName(raw.nombre) || "Sin nombre",
    grupo: normalizeGroup(raw.grupo),
    fecha: day,
    seconds,
    hora: timeOfDay(seconds),
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    via: text(raw.via) === "manual" || manual ? "manual" : "chip",
    chip: normalizeUid(raw.chip),
    motivo: text(manual && manual.motivo),
    porUid: text(manual && manual.porUid),
    porNombre: text(manual && manual.porNombre),
    registradoEn: Number(manual && manual.registradoEn) || 0
  };
  record.registro = registrationLabel(record);
  return record;
}

// Almuerzos de un día: Map matrícula → registro.
export function normalizeDay(rawDay, day) {
  const records = new Map();
  Object.entries(rawDay || {}).forEach(([matricula, raw]) => {
    const record = normalizeRecord(matricula, raw, day);
    if (record) records.set(matricula, record);
  });
  return records;
}

// Toda la asistencia descargada: Map día → Map matrícula → registro.
export function normalizeAttendance(raw) {
  const days = new Map();
  Object.entries(raw || {}).forEach(([day, rawDay]) => {
    if (!isDayKey(day) || !rawDay || typeof rawDay !== "object") return;
    days.set(day, normalizeDay(rawDay, day));
  });
  return days;
}

/*
 * Estado de un día (para todo el colegio):
 *   futuro       → aún no llega.
 *   en-curso     → hoy, antes de la hora de cierre del almuerzo.
 *   sin-servicio → ya pasó y nadie registró almuerzo (festivo no marcado, no llegó la comida…).
 *   cerrado      → ya pasó y hubo servicio: quien no tiene registro no asistió.
 */
export function dayState(day, context) {
  if (day > context.today) return "futuro";
  if (day === context.today && context.nowSeconds < context.cierreSeconds) return "en-curso";
  const records = context.attendance.get(day);
  return records && records.size ? "cerrado" : "sin-servicio";
}

export function cellState(beneficiary, day, state, record, noClass) {
  if (noClass) return CELL.SIN_CLASES;
  if (record) return CELL.ASISTIO;
  if (beneficiary && beneficiary.desde && day < beneficiary.desde) return CELL.NO_APLICA;
  if (state === "futuro") return CELL.FUTURO;
  if (state === "en-curso") return CELL.PENDIENTE;
  if (state === "sin-servicio") return CELL.SIN_SERVICIO;
  return CELL.NO_ASISTIO;
}

// Columnas de la planilla: los días de lunes a viernes del periodo y cualquier sábado o domingo con almuerzos.
export function reportDays(range, attendance) {
  const days = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const records = attendance.get(day);
    if (!isWeekend(day) || (records && records.size)) days.push(day);
  }
  return days;
}

/*
 * Planilla de un grupo con el formato del «Listado de grupo con número de orden».
 * context = { attendance, beneficiaries, noClass, today, nowSeconds, cierreSeconds }
 */
export function buildPlanilla(group, days, context) {
  const members = groupMembers(context.beneficiaries, group);
  const memberSet = new Set(members.map((item) => item.matricula));
  const byMatricula = new Map(context.beneficiaries.map((item) => [item.matricula, item]));

  const columns = days.map((day) => {
    const noClass = noClassPeriodFor(context.noClass, day, group);
    return {
      day,
      number: Number(day.slice(8)),
      noClass,
      state: noClass ? "sin-clases" : dayState(day, context)
    };
  });

  // Quien almorzó en este grupo pero ya no está en él (lo retiraron del PAE o lo cambiaron de grupo).
  const extra = new Map();
  days.forEach((day) => {
    (context.attendance.get(day) || new Map()).forEach((record) => {
      if (record.grupo !== group || memberSet.has(record.matricula) || extra.has(record.matricula)) return;
      const now = byMatricula.get(record.matricula);
      extra.set(record.matricula, {
        matricula: record.matricula,
        nombre: record.nombre,
        estado: now && now.grupo ? "AHORA EN " + now.grupo : "RETIRADO",
        extra: true
      });
    });
  });

  const rows = [...members, ...[...extra.values()].sort((first, second) => nameCollator.compare(first.nombre, second.nombre))]
    .map((item, index) => {
      const cells = columns.map((column) => {
        const record = (context.attendance.get(column.day) || new Map()).get(item.matricula) || null;
        // Las filas añadidas sólo muestran los almuerzos que sí tuvieron en este grupo.
        if (item.extra) {
          if (column.noClass) return { state: CELL.SIN_CLASES, record: null };
          if (column.state === "sin-servicio") return { state: CELL.SIN_SERVICIO, record: null };
          return record && record.grupo === group ? { state: CELL.ASISTIO, record } : { state: CELL.NO_APLICA, record: null };
        }
        return { state: cellState(item, column.day, column.state, record, column.noClass), record };
      });
      return {
        n: index + 1,
        matricula: item.matricula,
        nombre: item.nombre,
        estado: item.estado,
        chip: item.chip || "",
        extra: Boolean(item.extra),
        cells,
        asistio: cells.filter((cell) => cell.state === CELL.ASISTIO).length,
        noAsistio: cells.filter((cell) => cell.state === CELL.NO_ASISTIO).length
      };
    });

  const totals = columns.map((column, index) => ({
    asistio: rows.filter((row) => row.cells[index].state === CELL.ASISTIO).length,
    noAsistio: rows.filter((row) => row.cells[index].state === CELL.NO_ASISTIO).length
  }));
  // Sólo los almuerzos que cuentan (un registro en un día sin clases no se cuenta).
  const records = rows.flatMap((row) => row.cells.filter((cell) => cell.state === CELL.ASISTIO).map((cell) => cell.record));

  return {
    group,
    code: groupCode(group),
    columns,
    rows,
    totals,
    beneficiarios: members.length,
    asistio: rows.reduce((sum, row) => sum + row.asistio, 0),
    noAsistio: rows.reduce((sum, row) => sum + row.noAsistio, 0),
    porChip: records.filter((record) => record.via === "chip").length,
    manuales: records.filter((record) => record.via === "manual").length,
    diasServicio: columns.filter((column) => column.state === "cerrado" || column.state === "en-curso").length
  };
}

export function attendanceRate(asistio, noAsistio) {
  const total = asistio + noAsistio;
  return total ? asistio / total : null;
}

/*
 * Informe del periodo. filters = { group } ("" = todos los grupos).
 * Devuelve la planilla de cada grupo con beneficiarios o almuerzos, el resumen por grupo y el
 * detalle de cada registro (para auditoría).
 */
export function runReport(range, filters, context) {
  const days = reportDays(range, context.attendance);
  const groupsWithData = new Set(context.beneficiaries.map((item) => item.grupo).filter(Boolean));
  days.forEach((day) => (context.attendance.get(day) || new Map()).forEach((record) => {
    if (record.grupo) groupsWithData.add(record.grupo);
  }));
  const groups = filters && filters.group ? [filters.group] : GROUPS.filter((group) => groupsWithData.has(group));
  const planillas = groups.map((group) => buildPlanilla(group, days, context));

  const totals = planillas.reduce((sum, planilla) => ({
    beneficiarios: sum.beneficiarios + planilla.beneficiarios,
    asistio: sum.asistio + planilla.asistio,
    noAsistio: sum.noAsistio + planilla.noAsistio,
    porChip: sum.porChip + planilla.porChip,
    manuales: sum.manuales + planilla.manuales
  }), { beneficiarios: 0, asistio: 0, noAsistio: 0, porChip: 0, manuales: 0 });

  const groupSet = new Set(groups);
  const detail = [];
  days.forEach((day) => (context.attendance.get(day) || new Map()).forEach((record) => {
    if (!groupSet.has(record.grupo)) return;
    if (noClassPeriodFor(context.noClass, day, record.grupo)) return;
    detail.push(record);
  }));
  detail.sort((first, second) => {
    if (first.fecha !== second.fecha) return first.fecha < second.fecha ? -1 : 1;
    if (first.grupo !== second.grupo) return compareGroups(first.grupo, second.grupo);
    return nameCollator.compare(first.nombre, second.nombre);
  });

  return { range, days, groups, planillas, totals, detail };
}

/* ---------- Importar el listado oficial ---------- */

const HEADER_WORDS = /matr[ií]cula|estudiante|nombre/i;

function looksLikeOrderNumber(value) {
  return /^\d{1,3}$/.test(text(value));
}

function splitCells(rawLine) {
  if (rawLine.includes("\t")) return rawLine.split("\t");
  if (rawLine.includes(";")) return rawLine.split(";");
  if (rawLine.includes(",") && rawLine.split(",").length >= 2) return rawLine.split(",");
  return null;
}

// Columnas según el encabezado copiado ("N° · MATRÍCULA · ESTUDIANTE · ESTADO · GRUPO"), o null.
function headerColumns(cells) {
  const find = (pattern) => cells.findIndex((cell) => pattern.test(cell));
  const columns = {
    matricula: find(/matr[ií]cula/i),
    nombre: find(/estudiante|nombre/i),
    estado: find(/estado/i),
    grupo: find(/grupo/i)
  };
  return columns.matricula >= 0 && columns.nombre >= 0 ? columns : null;
}

/*
 * Lee filas copiadas de Excel (separadas por tabulador), de un CSV (; o ,) o de un PDF
 * (separadas por espacios). Columnas: [N°] Matrícula, Estudiante, [Estado], [Grupo]; si se copia
 * también el encabezado, se usan las columnas que indique.
 * Devuelve { rows: [{ line, matricula, nombre, estado, grupo }], errors: [{ line, message }] }.
 */
export function parseRoster(input, defaultGroup) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  let layout = null;
  text(input).split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    if (!rawLine.trim()) return;
    let cells = splitCells(rawLine);

    let matricula = "";
    let nombre = "";
    let estado = "";
    let grupo = "";
    if (cells) {
      cells = cells.map(text);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some((cell) => HEADER_WORDS.test(cell)) && !cells.some(normalizeMatricula)) {
        layout = headerColumns(cells) || layout;
        return;
      }
      if (layout) {
        const at = (position) => (position >= 0 ? cells[position] || "" : "");
        [matricula, nombre, estado, grupo] = [at(layout.matricula), at(layout.nombre), at(layout.estado), at(layout.grupo)];
      } else {
        if (cells.length >= 3 && looksLikeOrderNumber(cells[0]) && normalizeMatricula(cells[1]) && !normalizeMatricula(cells[2])) {
          cells.shift();
        }
        [matricula, nombre, estado, grupo] = [cells[0], cells[1], cells[2] || "", cells[3] || ""];
      }
    } else {
      // Texto copiado de un PDF: "241081 ALVAREZ CUREQUIA ANDREA ALMUERZO".
      if (HEADER_WORDS.test(rawLine) && !/\d{3,}/.test(rawLine)) return;
      const words = rawLine.trim().split(/\s+/);
      if (words.length >= 3 && looksLikeOrderNumber(words[0]) && normalizeMatricula(words[1]) && /\d{4,}/.test(words[1])) words.shift();
      matricula = words.shift() || "";
      if (words.length && words[words.length - 1].toUpperCase() === DEFAULT_ESTADO) estado = words.pop();
      nombre = words.join(" ");
    }

    const cleanMatricula = normalizeMatricula(matricula);
    const cleanNombre = cleanName(nombre);
    const cleanGroup = grupo ? normalizeGroupLoose(grupo) : defaultGroup;
    if (!cleanMatricula) {
      errors.push({ line, message: "Línea " + line + ": la matrícula «" + text(matricula) + "» no es válida." });
      return;
    }
    if (!cleanNombre || cleanNombre.length > 120) {
      errors.push({ line, message: "Línea " + line + ": falta el nombre del estudiante." });
      return;
    }
    if (!GROUPS.includes(cleanGroup)) {
      errors.push({ line, message: "Línea " + line + ": el grupo «" + text(grupo) + "» no es de 6.1 a 11.3." });
      return;
    }
    if (seen.has(cleanMatricula)) {
      errors.push({ line, message: "Línea " + line + ": la matrícula " + cleanMatricula + " está repetida en la lista." });
      return;
    }
    seen.add(cleanMatricula);
    rows.push({
      line,
      matricula: cleanMatricula,
      nombre: cleanNombre,
      estado: cleanName(estado).toUpperCase().slice(0, 40) || DEFAULT_ESTADO,
      grupo: cleanGroup
    });
  });
  return { rows, errors };
}

/* ---------- Vincular chips desde las fichas del sistema de llegadas tarde ---------- */

/*
 * Busca, para cada beneficiario sin chip, la tarjeta de /estudiantes con el mismo nombre.
 * Exacta: las mismas palabras del nombre en el mismo grupo (o en un solo grupo del colegio).
 * Parcial: todas las palabras de un nombre están en el otro (al menos dos), en el mismo grupo.
 * Nunca propone un chip que ya usa otro beneficiario ni el mismo chip para dos personas.
 */
export function matchChips(beneficiaries, students, chipsInUse) {
  const used = new Set(Object.keys(chipsInUse || {}).map(normalizeUid).filter(Boolean));
  beneficiaries.forEach((item) => { if (item.chip) used.add(item.chip); });
  const cards = Object.entries(students || {})
    .filter((entry) => entry[1] && typeof entry[1] === "object")
    .map(([uid, student]) => ({
      chip: normalizeUid(uid),
      nombre: cleanName(student.nombre),
      grupo: normalizeGroup(student.grupo),
      key: nameKey(student.nombre),
      tokens: new Set(nameTokens(student.nombre))
    }))
    .filter((card) => card.chip && card.key && !used.has(card.chip));

  const proposals = [];
  let sinCoincidencia = 0;
  let ambiguos = 0;
  beneficiaries.filter((item) => !item.chip).forEach((item) => {
    const key = nameKey(item.nombre);
    const tokens = nameTokens(item.nombre);
    let candidates = cards.filter((card) => card.key === key && card.grupo === item.grupo);
    let kind = "exacta";
    if (!candidates.length) candidates = cards.filter((card) => card.key === key);
    if (!candidates.length) {
      kind = "parcial";
      candidates = cards.filter((card) => {
        if (card.grupo !== item.grupo) return false;
        const smaller = card.tokens.size <= tokens.length ? [...card.tokens] : tokens;
        const larger = card.tokens.size <= tokens.length ? new Set(tokens) : card.tokens;
        return smaller.length >= 2 && smaller.every((token) => larger.has(token));
      });
    }
    if (!candidates.length) {
      sinCoincidencia += 1;
      return;
    }
    if (candidates.length > 1) {
      ambiguos += 1;
      return;
    }
    proposals.push({
      matricula: item.matricula,
      nombre: item.nombre,
      grupo: item.grupo,
      chip: candidates[0].chip,
      nombreTarjeta: candidates[0].nombre,
      grupoTarjeta: candidates[0].grupo,
      kind
    });
  });

  // Un mismo chip propuesto para dos beneficiarios: no se propone a ninguno.
  const counts = new Map();
  proposals.forEach((proposal) => counts.set(proposal.chip, (counts.get(proposal.chip) || 0) + 1));
  const unique = proposals.filter((proposal) => counts.get(proposal.chip) === 1);
  return {
    proposals: unique,
    sinCoincidencia,
    ambiguos: ambiguos + proposals.length - unique.length,
    yaTienenChip: beneficiaries.filter((item) => item.chip).length
  };
}

/* Días seriales de Excel (sistema 1900): 1899-12-30 es el día 0. */
export function excelDateSerial(key) {
  return dayNumber(key) - dayNumber("1899-12-30");
}

export function excelTimeFraction(seconds) {
  return seconds / 86400;
}
