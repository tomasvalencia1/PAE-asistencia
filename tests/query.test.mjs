/*
 * Pruebas de query.js (lógica del almuerzo PAE). Ejecutar desde la carpeta tests:
 *   npm run test:query
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL,
  buildPlanilla,
  cellState,
  dayState,
  groupCode,
  matchChips,
  nameKey,
  normalizeAttendance,
  normalizeBeneficiaries,
  normalizeGroupLoose,
  normalizeMatricula,
  normalizeNoClassPeriods,
  parseRoster,
  periodRange,
  reportDays,
  runReport,
  secondsNow,
  todayKey
} from "../query.js";

// Martes 20 de octubre de 2026, 12:30 p. m. en Bogotá (17:30 UTC).
const NOW = Date.UTC(2026, 9, 20, 17, 30, 0);

const rawBeneficiaries = {
  "241081": { matricula: "241081", nombre: "ALVAREZ CUREQUIA ANDREA", grupo: "6.1", estado: "ALMUERZO", orden: 1, chip: "04A1B2C3D4" },
  "221096": { matricula: "221096", nombre: "DAVILA BOTERO MATHIAS", grupo: "6.1", estado: "ALMUERZO", orden: 2 },
  "260034": { matricula: "260034", nombre: "JARAMILLO MEDINA CELESTE", grupo: "6.1", estado: "ALMUERZO", orden: 3, desde: "2026-10-15" },
  "211041": { matricula: "211041", nombre: "PEREZ ARREDONDO JUAN FELIPE", grupo: "6.2", estado: "ALMUERZO", orden: 1 }
};

function record(matricula, grupo, nombre, via = "chip", hora = "12:05:00") {
  return { matricula, nombre, grupo, fecha: "", hora, timestamp: 1, via, ...(via === "manual"
    ? { manual: { porUid: "doc", porNombre: "Docente", motivo: "sin-chip", registradoEn: 1 } }
    : { chip: "04A1B2C3D4" }) };
}

const rawAttendance = {
  // Lunes 12: festivo, nadie registró.
  "2026-10-13": {
    "241081": record("241081", "6.1", "ALVAREZ CUREQUIA ANDREA"),
    "221096": record("221096", "6.1", "DAVILA BOTERO MATHIAS", "manual"),
    "211041": record("211041", "6.2", "PEREZ ARREDONDO JUAN FELIPE")
  },
  // Miércoles 14: no hubo clase (marcado en el panel de llegadas tarde).
  "2026-10-15": {
    "241081": record("241081", "6.1", "ALVAREZ CUREQUIA ANDREA"),
    // Un retirado que almorzó en 6.1.
    "199999": record("199999", "6.1", "RETIRADO DEL PAE")
  },
  // Viernes 16: nadie registró (no hubo servicio).
  "2026-10-19": {
    "221096": record("221096", "6.1", "DAVILA BOTERO MATHIAS", "manual"),
    // Pérez almorzó en 6.1 antes de pasar a 6.2 (aparece como fila adicional en 6.1).
    "211041": record("211041", "6.1", "PEREZ ARREDONDO JUAN FELIPE")
  },
  "2026-10-20": {
    "241081": record("241081", "6.1", "ALVAREZ CUREQUIA ANDREA")
  }
};

const noClass = normalizeNoClassPeriods(
  { festivo: { desde: "2026-10-12", hasta: "2026-10-12", motivo: "Festivo", grupos: "todos" } },
  { receso: { desde: "2026-10-14", hasta: "2026-10-14", motivo: "No hubo clase", grupos: "6.1,6.2" } }
);

function context(overrides = {}) {
  return {
    beneficiaries: normalizeBeneficiaries(rawBeneficiaries),
    attendance: normalizeAttendance(rawAttendance),
    noClass,
    today: todayKey(NOW),
    nowSeconds: secondsNow(NOW),
    cierreSeconds: 14 * 3600,
    ...overrides
  };
}

test("códigos de grupo del listado oficial", () => {
  assert.equal(groupCode("6.1"), "060100");
  assert.equal(groupCode("11.3"), "110300");
  assert.equal(normalizeGroupLoose("060100"), "6.1");
  assert.equal(normalizeGroupLoose("0601"), "6.1");
  assert.equal(normalizeGroupLoose("110300"), "11.3");
  assert.equal(normalizeGroupLoose("10-2"), "10.2");
  assert.equal(normalizeGroupLoose("12.1"), "");
});

test("matrículas válidas", () => {
  assert.equal(normalizeMatricula(" 241081 "), "241081");
  assert.equal(normalizeMatricula("ab-12"), "AB-12");
  assert.equal(normalizeMatricula("ALVAREZ"), "");
  assert.equal(normalizeMatricula("24/10"), "");
});

test("hoy y hora en Colombia aunque el equipo esté en otra zona", () => {
  assert.equal(todayKey(NOW), "2026-10-20");
  assert.equal(secondsNow(NOW), 12 * 3600 + 30 * 60);
  // 11:30 p. m. del 20 en Bogotá ya es 21 en UTC.
  assert.equal(todayKey(Date.UTC(2026, 9, 21, 4, 30)), "2026-10-20");
});

test("periodos: mes, rango (con tope de 62 días) y semana de lunes a domingo", () => {
  assert.deepEqual([periodRange({ type: "mes" }, NOW).start, periodRange({ type: "mes" }, NOW).end], ["2026-10-01", "2026-10-31"]);
  const range = periodRange({ type: "rango", value: { from: "2026-10-30", to: "2026-10-13" } }, NOW);
  assert.deepEqual([range.start, range.end], ["2026-10-13", "2026-10-30"]);
  const long = periodRange({ type: "rango", value: { from: "2026-01-01", to: "2026-12-31" } }, NOW);
  assert.equal(long.end, "2026-03-03");
  assert.equal(long.capped, true);
  const week = periodRange({ type: "semana" }, NOW);
  assert.deepEqual([week.start, week.end], ["2026-10-19", "2026-10-25"]);
});

test("estado del día: en curso antes del cierre, cerrado después, sin servicio si nadie registró", () => {
  const ctx = context();
  assert.equal(dayState("2026-10-20", ctx), "en-curso");
  assert.equal(dayState("2026-10-20", { ...ctx, nowSeconds: 14 * 3600 }), "cerrado");
  assert.equal(dayState("2026-10-19", ctx), "cerrado");
  assert.equal(dayState("2026-10-16", ctx), "sin-servicio");
  assert.equal(dayState("2026-10-21", ctx), "futuro");
  assert.equal(dayState("2026-10-20", { ...ctx, attendance: new Map(), nowSeconds: 15 * 3600 }), "sin-servicio");
});

test("casilla: con registro asistió; sin registro en día cerrado no asistió", () => {
  const beneficiary = { desde: "2026-10-15" };
  assert.equal(cellState(beneficiary, "2026-10-19", "cerrado", { via: "chip" }, null), CELL.ASISTIO);
  assert.equal(cellState(beneficiary, "2026-10-19", "cerrado", null, null), CELL.NO_ASISTIO);
  assert.equal(cellState(beneficiary, "2026-10-20", "en-curso", null, null), CELL.PENDIENTE);
  assert.equal(cellState(beneficiary, "2026-10-13", "cerrado", null, null), CELL.NO_APLICA);
  assert.equal(cellState(beneficiary, "2026-10-16", "sin-servicio", null, null), CELL.SIN_SERVICIO);
  assert.equal(cellState(beneficiary, "2026-10-19", "cerrado", { via: "chip" }, { motivo: "Festivo" }), CELL.SIN_CLASES);
});

test("columnas: días de lunes a viernes del periodo", () => {
  const ctx = context();
  const days = reportDays(periodRange({ type: "rango", value: { from: "2026-10-12", to: "2026-10-25" } }, NOW), ctx.attendance);
  assert.deepEqual(days, [
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
    "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"
  ]);
});

test("planilla del grupo 6.1 con el formato del listado", () => {
  const ctx = context();
  const days = reportDays(periodRange({ type: "rango", value: { from: "2026-10-12", to: "2026-10-23" } }, NOW), ctx.attendance);
  const planilla = buildPlanilla("6.1", days, ctx);
  assert.equal(planilla.code, "060100");
  assert.deepEqual(planilla.columns.map((column) => column.state), [
    "sin-clases", "cerrado", "sin-clases", "cerrado", "sin-servicio", "cerrado", "en-curso", "futuro", "futuro", "futuro"
  ]);
  assert.equal(planilla.columns[0].noClass.motivo, "Festivo");
  assert.equal(planilla.columns[2].noClass.source, "panel");

  const byMatricula = new Map(planilla.rows.map((row) => [row.matricula, row]));
  assert.deepEqual(planilla.rows.map((row) => row.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(planilla.rows.slice(0, 3).map((row) => row.matricula), ["241081", "221096", "260034"]);

  const andrea = byMatricula.get("241081").cells.map((cell) => cell.state);
  assert.deepEqual(andrea, [CELL.SIN_CLASES, CELL.ASISTIO, CELL.SIN_CLASES, CELL.ASISTIO, CELL.SIN_SERVICIO, CELL.NO_ASISTIO, CELL.ASISTIO, CELL.FUTURO, CELL.FUTURO, CELL.FUTURO]);
  const mathias = byMatricula.get("221096").cells.map((cell) => cell.state);
  assert.deepEqual(mathias.slice(0, 7), [CELL.SIN_CLASES, CELL.ASISTIO, CELL.SIN_CLASES, CELL.NO_ASISTIO, CELL.SIN_SERVICIO, CELL.ASISTIO, CELL.PENDIENTE]);
  // Celeste entró al PAE el 15: el 13 no cuenta como ausencia.
  const celeste = byMatricula.get("260034").cells.map((cell) => cell.state);
  assert.deepEqual(celeste.slice(0, 7), [CELL.SIN_CLASES, CELL.NO_APLICA, CELL.SIN_CLASES, CELL.NO_ASISTIO, CELL.SIN_SERVICIO, CELL.NO_ASISTIO, CELL.PENDIENTE]);

  // Filas adicionales: el retirado y quien pasó a 6.2, con sólo sus almuerzos en 6.1.
  assert.equal(byMatricula.get("199999").estado, "RETIRADO");
  assert.equal(byMatricula.get("211041").estado, "AHORA EN 6.2");
  assert.deepEqual(byMatricula.get("211041").cells.map((cell) => cell.state).slice(0, 6),
    [CELL.SIN_CLASES, CELL.NO_APLICA, CELL.SIN_CLASES, CELL.NO_APLICA, CELL.SIN_SERVICIO, CELL.ASISTIO]);

  assert.equal(planilla.beneficiarios, 3);
  assert.deepEqual(planilla.totals.map((total) => total.asistio), [0, 2, 0, 2, 0, 2, 1, 0, 0, 0]);
  assert.deepEqual(planilla.totals.map((total) => total.noAsistio), [0, 0, 0, 2, 0, 2, 0, 0, 0, 0]);
  assert.equal(planilla.asistio, 7);
  assert.equal(planilla.noAsistio, 4);
  assert.equal(planilla.manuales, 2);
  assert.equal(planilla.porChip, 5);
});

test("un almuerzo registrado en un día que luego se marcó sin clases no se cuenta en ningún total", () => {
  const ctx = context({
    noClass: normalizeNoClassPeriods({ p: { desde: "2026-10-13", hasta: "2026-10-13", motivo: "Paro", grupos: "todos" } }, {})
  });
  const planilla = buildPlanilla("6.1", ["2026-10-13", "2026-10-15"], ctx);
  assert.equal(planilla.asistio, 2);
  assert.equal(planilla.porChip + planilla.manuales, planilla.asistio);
  const report = runReport(periodRange({ type: "rango", value: { from: "2026-10-13", to: "2026-10-15" } }, NOW), {}, ctx);
  assert.ok(report.detail.every((item) => item.fecha !== "2026-10-13"));
});

test("después del cierre, quien no tiene registro de hoy queda como no asistió", () => {
  const ctx = context({ nowSeconds: 15 * 3600 });
  const planilla = buildPlanilla("6.1", ["2026-10-20"], ctx);
  assert.deepEqual(planilla.rows.map((row) => row.cells[0].state), [CELL.ASISTIO, CELL.NO_ASISTIO, CELL.NO_ASISTIO]);
});

test("informe: una planilla por grupo con datos y detalle sin los días sin clases", () => {
  const ctx = context();
  const report = runReport(periodRange({ type: "rango", value: { from: "2026-10-12", to: "2026-10-23" } }, NOW), {}, ctx);
  assert.deepEqual(report.groups, ["6.1", "6.2"]);
  assert.equal(report.totals.beneficiarios, 4);
  // El almuerzo del 15 de 6.1 cuenta; en el 14 no había clase y no hay registros.
  assert.ok(report.detail.every((item) => item.fecha !== "2026-10-12" && item.fecha !== "2026-10-14"));
  assert.equal(report.detail.length, 8);
  const only = runReport(periodRange({ type: "mes" }, NOW), { group: "6.2" }, ctx);
  assert.deepEqual(only.groups, ["6.2"]);
});

test("importar: filas copiadas de Excel sin encabezado, con o sin N° y columna de grupo", () => {
  const input = [
    "1\t241081\tALVAREZ CUREQUIA ANDREA\tALMUERZO",
    "2\t221096\tDAVILA  BOTERO MATHIAS\tALMUERZO",
    "",
    "201029\tHERNANDEZ FLOREZ YESSID\tALMUERZO\t060200",
    "abc\tPEREZ LUIS\tALMUERZO",
    "241081\tREPETIDA\tALMUERZO"
  ].join("\n");
  const { rows, errors } = parseRoster(input, "6.1");
  assert.deepEqual(rows.map((row) => [row.matricula, row.nombre, row.estado, row.grupo]), [
    ["241081", "ALVAREZ CUREQUIA ANDREA", "ALMUERZO", "6.1"],
    ["221096", "DAVILA BOTERO MATHIAS", "ALMUERZO", "6.1"],
    ["201029", "HERNANDEZ FLOREZ YESSID", "ALMUERZO", "6.2"]
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /no es válida/);
  assert.match(errors[1].message, /repetida/);
});

test("importar: con encabezado se usan sus columnas (N°, matrícula, estudiante, grupo)", () => {
  const input = [
    "N°\tGRUPO\tMATRÍCULA\tESTUDIANTE",
    "1\t070100\t250101\tACOSTA RIOS VALENTINA",
    "4\t070100\tXX\tSIN MATRICULA VALIDA"
  ].join("\n");
  const { rows, errors } = parseRoster(input, "6.1");
  assert.deepEqual(rows.map((row) => [row.matricula, row.nombre, row.estado, row.grupo]), [
    ["250101", "ACOSTA RIOS VALENTINA", "ALMUERZO", "7.1"]
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /la matrícula «XX» no es válida/);
});

test("importar: texto copiado de un PDF y CSV con punto y coma", () => {
  const pdf = parseRoster("241081 ALVAREZ CUREQUIA ANDREA ALMUERZO\n221096 DAVILA BOTERO MATHIAS", "7.2");
  assert.deepEqual(pdf.rows.map((row) => [row.matricula, row.nombre, row.estado, row.grupo]), [
    ["241081", "ALVAREZ CUREQUIA ANDREA", "ALMUERZO", "7.2"],
    ["221096", "DAVILA BOTERO MATHIAS", "ALMUERZO", "7.2"]
  ]);
  const csv = parseRoster("MATRICULA;ESTUDIANTE\n211148;HERNANDEZ GOMEZ ALEJANDRO", "8.3");
  assert.deepEqual(csv.rows.map((row) => row.matricula), ["211148"]);
  assert.equal(csv.errors.length, 0);
});

test("vincular chips: mismo nombre en otro orden y sin tildes, nunca un chip ya usado", () => {
  const beneficiaries = normalizeBeneficiaries({
    "1001": { matricula: "1001", nombre: "ÁLVAREZ CUREQUIA ANDREA", grupo: "6.1", estado: "ALMUERZO", orden: 1 },
    "1002": { matricula: "1002", nombre: "HERNANDEZ GOMEZ SALOME", grupo: "6.1", estado: "ALMUERZO", orden: 2 },
    "1003": { matricula: "1003", nombre: "LOBO HOYOS THOMAS DAVID", grupo: "6.1", estado: "ALMUERZO", orden: 3 },
    "1004": { matricula: "1004", nombre: "ROJAS PEREZ SALOME", grupo: "6.1", estado: "ALMUERZO", orden: 4 },
    "1005": { matricula: "1005", nombre: "MESA PANIAGUA LAUREN", grupo: "6.1", estado: "ALMUERZO", orden: 5, chip: "0000AAAA" }
  });
  const students = {
    "AAAA0001": { nombre: "Andrea Alvarez Curequia", grupo: "6.1" },
    "AAAA0002": { nombre: "Salomé Hernández Gómez", grupo: "6.1" },
    "AAAA0003": { nombre: "Salome Hernandez Gomez", grupo: "6.2" },
    "AAAA0004": { nombre: "Thomas Lobo", grupo: "6.1" },
    "AAAA0005": { nombre: "Salomé Rojas Pérez", grupo: "6.1" }
  };
  const result = matchChips(beneficiaries, students, { AAAA0005: "9999" });
  const byMatricula = new Map(result.proposals.map((proposal) => [proposal.matricula, proposal]));
  assert.equal(byMatricula.get("1001").chip, "AAAA0001");
  assert.equal(byMatricula.get("1001").kind, "exacta");
  // Hay otra Salomé Hernández Gómez en 6.2, pero la del mismo grupo gana.
  assert.equal(byMatricula.get("1002").chip, "AAAA0002");
  assert.equal(byMatricula.get("1003").kind, "parcial");
  // El chip de Salomé Rojas ya está en uso por otro beneficiario.
  assert.equal(byMatricula.has("1004"), false);
  assert.equal(result.yaTienenChip, 1);
  assert.equal(nameKey("Álvarez  Curequia, Andrea"), nameKey("ANDREA ALVAREZ CUREQUIA"));
});
