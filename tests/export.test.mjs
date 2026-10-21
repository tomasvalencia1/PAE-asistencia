/*
 * Genera una planilla real con write-excel-file (la misma copia de /vendor que usa el panel) y
 * revisa el .xlsx por dentro: una hoja por grupo con el formato del listado, celdas combinadas
 * de los días sin clases, ✓ / X, escudo y hojas Resumen y Detalle.
 *
 * Deja el archivo en tests/out/ejemplo-planilla-PAE.xlsx para abrirlo en Excel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { normalizeAttendance, normalizeBeneficiaries, normalizeNoClassPeriods, periodRange, runReport } from "../query.js";
import { buildWorkbook, fileNameFor, fitSheetsToPage } from "../export-xlsx.js";

const require = createRequire(import.meta.url);
const writeXlsxFile = require("../vendor/write-excel-file-4.1.1.min.js");

// Lee un .zip (el .xlsx) sin dependencias: directorio central + inflate.
function unzip(buffer) {
  const files = {};
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const NOW = Date.UTC(2026, 9, 20, 20, 0, 0); // martes 20 de octubre de 2026, 3:00 p. m. en Bogotá

const names = [
  ["241081", "ALVAREZ CUREQUIA ANDREA"], ["221096", "DAVILA BOTERO MATHIAS"], ["201029", "HERNANDEZ FLOREZ YESSID"],
  ["211148", "HERNANDEZ GOMEZ ALEJANDRO"], ["211147", "HERNANDEZ GOMEZ SALOME"], ["241067", "LOBO HOYOS THOMAS DAVID"],
  ["201040", "LOPEZ MORA PAULINA"], ["201160", "MARTINEZ CASTAÑO CELESTE"], ["260008", "MESA PANIAGUA LAUREN"],
  ["201023", "NARVAEZ RIAÑO SALOME"], ["211041", "PEREZ ARREDONDO JUAN FELIPE"], ["201180", "RESTREPO RAMIREZ TIFANY EXTRELLA"],
  ["211066", "ROJAS PEREZ SALOME"], ["260034", "JARAMILLO MEDINA CELESTE"]
];

function sampleContext() {
  const raw = {};
  names.forEach(([matricula, nombre], index) => {
    raw[matricula] = { matricula, nombre, grupo: "6.1", estado: "ALMUERZO", orden: index + 1, ...(index % 3 ? { chip: "0A0B0C" + String(index).padStart(2, "0") } : {}) };
  });
  raw["300001"] = { matricula: "300001", nombre: "GOMEZ RUIZ ANA", grupo: "7.2", estado: "ALMUERZO", orden: 1 };
  const attendance = {};
  ["2026-10-13", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"].forEach((day) => {
    attendance[day] = {};
    names.forEach(([matricula, nombre], index) => {
      // Narváez faltó el 15 y Lobo el 16, como en el listado de la foto.
      if ((day === "2026-10-15" && matricula === "201023") || (day === "2026-10-16" && matricula === "241067")) return;
      if (day === "2026-10-20" && index > 10) return;
      attendance[day][matricula] = {
        matricula, nombre, grupo: "6.1", fecha: day, hora: "12:0" + (index % 10) + ":00", timestamp: 1,
        ...(index % 3 ? { via: "chip", chip: "0A0B0C" + String(index).padStart(2, "0") }
          : { via: "manual", manual: { porUid: "doc", porNombre: "Docente Prueba", motivo: "sin-asignar", registradoEn: 1 } })
      };
    });
  });
  return {
    beneficiaries: normalizeBeneficiaries(raw),
    attendance: normalizeAttendance(attendance),
    noClass: normalizeNoClassPeriods({ p: { desde: "2026-10-14", hasta: "2026-10-14", motivo: "Jornada pedagógica", grupos: "todos" } }, {}),
    today: "2026-10-20",
    nowSeconds: 15 * 3600,
    cierreSeconds: 14 * 3600
  };
}

test("planilla real: formato del listado, días sin clases combinados, resumen y detalle", async () => {
  const range = periodRange({ type: "rango", value: { from: "2026-10-13", to: "2026-10-30" } }, NOW);
  const report = runReport(range, {}, sampleContext());
  const logo = new Blob([readFileSync(new URL("../logo-ieruu.png", import.meta.url))], { type: "image/png" });
  const sheets = buildWorkbook(report, {
    jornada: "Mañana",
    cierreLabel: "2:00 p. m.",
    generatedBy: "Directiva Prueba (Directivo)",
    groupLabel: "Todos los grupos con beneficiarios",
    logo,
    nowMs: NOW
  });
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["Grupo 6.1", "Grupo 7.2", "Resumen", "Detalle"]);

  const blob = await fitSheetsToPage(await writeXlsxFile(sheets, { fontFamily: "Calibri", fontSize: 11 }).toBlob());
  const buffer = Buffer.from(await blob.arrayBuffer());
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./out/ejemplo-planilla-PAE.xlsx", import.meta.url), buffer);

  const files = unzip(buffer);
  const workbook = files["xl/workbook.xml"];
  assert.match(workbook, /name="Grupo 6\.1"/);
  assert.match(workbook, /name="Resumen"/);
  const strings = files["xl/sharedStrings.xml"];
  for (const value of [
    "INSTITUCIÓN EDUCATIVA", "RAFAEL URIBE URIBE", "Listado de grupo con número de orden",
    "GRUPO: 060100 - JORNADA: Mañana", "MATRÍCULA", "ESTUDIANTE", "ESTADO", "ALMUERZO",
    "ALVAREZ CUREQUIA ANDREA", "MARTINEZ CASTAÑO CELESTE", "✓", "X", "No hubo clase · Jornada pedagógica", "Total de estudiantes"
  ]) {
    assert.ok(strings.includes(value), "falta el texto «" + value + "» en la planilla");
  }
  const sheet1 = files["xl/worksheets/sheet1.xml"];
  // Columna del 14 (sin clases): una celda combinada a lo largo de los 14 estudiantes.
  assert.match(sheet1, /<mergeCell ref="F\d+:F\d+"\/>/);
  const merge = sheet1.match(/<mergeCell ref="F(\d+):F(\d+)"\/>/);
  assert.equal(Number(merge[2]) - Number(merge[1]) + 1, 14);
  assert.match(sheet1, /orientation="landscape"/);
  // Impresión: papel carta y todas las columnas en una página de ancho, en todas las hojas.
  for (const name of ["sheet1", "sheet2", "sheet3", "sheet4"]) {
    const xml = files["xl/worksheets/" + name + ".xml"];
    assert.match(xml, /<pageSetup [^>]*paperSize="1" fitToWidth="1" fitToHeight="0"\/>/);
    assert.match(xml, /^<\?xml[^>]*\?><worksheet [^>]*><sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  }
  assert.match(sheet1, /showGridLines="(0|false)"/);
  assert.ok(files["xl/media/sheet1-image1.png"] !== undefined, "falta el escudo en la hoja del grupo");
  assert.ok(files["xl/drawings/drawing1.xml"].includes("Escudo IERUU"));
  // Matrícula como texto, para que Excel no la convierta en número.
  assert.ok(strings.includes("241081"));

  assert.equal(report.planillas[0].rows.length, 14);
  assert.equal(fileNameFor(report, {}, NOW), "PAE-almuerzo_todos-los-grupos_2026-10-13_a_2026-10-30_generado-2026-10-20.xlsx");
});

test("planilla de un solo día: el bloque de contacto va debajo del nombre", async () => {
  const range = periodRange({ type: "dia", value: "2026-10-20" }, NOW);
  const report = runReport(range, { group: "6.1" }, sampleContext());
  const sheets = buildWorkbook(report, { jornada: "Mañana", cierreLabel: "2:00 p. m.", generatedBy: "Prueba", groupLabel: "Grupo 6.1", logo: null, nowMs: NOW });
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["Grupo 6.1", "Resumen", "Detalle"]);
  const blob = await writeXlsxFile(sheets, { fontFamily: "Calibri", fontSize: 11 }).toBlob();
  const files = unzip(Buffer.from(await blob.arrayBuffer()));
  assert.ok(files["xl/sharedStrings.xml"].includes("Sede principal · Carrera 82 N°42C-56"));
  assert.match(files["xl/worksheets/sheet1.xml"], /orientation="portrait"/);
  // 3:00 p. m., ya pasó el cierre: 11 almorzaron y 3 no asistieron.
  assert.equal(report.planillas[0].asistio, 11);
  assert.equal(report.planillas[0].noAsistio, 3);
});
