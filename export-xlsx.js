/*
 * Planilla de Excel (.xlsx real, Office Open XML) de la asistencia al almuerzo del PAE.
 *
 * Recibe el resultado de runReport() — el mismo objeto que pinta la vista de informes — de modo
 * que el archivo y la pantalla siempre coinciden.
 *
 * Cada grupo va en su propia hoja con el formato del «Listado de grupo con número de orden» del
 * colegio: escudo y datos de la institución, «GRUPO: 060100 - JORNADA: Mañana» y la tabla N°,
 * MATRÍCULA, ESTUDIANTE, ESTADO y una columna por cada día de clase del periodo:
 *   ✓ = asistió al almuerzo · X = no asistió al almuerzo · columna gris = no hubo clase / servicio.
 * Al final van una hoja «Resumen» (totales por grupo) y una hoja «Detalle» (cada registro, con la
 * hora y si fue con chip o a mano), útiles para la rendición de cuentas del PAE.
 *
 * Biblioteca: write-excel-file 4.1.1 (MIT), alojada en /vendor con versión fija y verificación de
 * integridad (SRI). Sólo se descarga la primera vez que alguien exporta.
 */

import {
  CELL,
  MANUAL_REASON_LABELS,
  attendanceRate,
  bogotaParts,
  excelDateSerial,
  excelTimeFraction,
  formatDayLong,
  makeDayKey
} from "./query.js";
import { INSTITUCION } from "./institucion.js";

const LIBRARY_URL = new URL("./vendor/write-excel-file-4.1.1.min.js", import.meta.url).href;
const LIBRARY_INTEGRITY = "sha384-l2MfkSyI8avyb18vtz3IbErBv7TD1l7FiGCWmZyl0eumLsUrXUXjiA1cd+nMppir";
const LOGO_URL = new URL("./logo-ieruu.png", import.meta.url).href;

export const CHECK = "✓";
export const CROSS = "X";

const BORDER = { borderStyle: "thin", borderColor: "#000000" };
const TABLE_HEADER = {
  ...BORDER,
  fontWeight: "bold",
  fontSize: 9,
  textColor: "#FFFFFF",
  backgroundColor: "#7F7F7F",
  align: "center",
  alignVertical: "center"
};
const SUMMARY_HEADER = {
  fontWeight: "bold",
  textColor: "#FFFFFF",
  backgroundColor: "#7F7F7F",
  alignVertical: "center",
  wrap: true
};
const DATE_FORMAT = "dd/mm/yyyy";
const TIME_FORMAT = "hh:mm:ss";
// Columnas fijas de la planilla: N°, MATRÍCULA, ESTUDIANTE, ESTADO.
const FIXED_COLUMNS = 4;
// Con menos días que esto, el bloque de contacto no cabe a la derecha y va debajo del nombre.
const WIDE_LAYOUT_DAYS = 8;

let libraryPromise = null;

function loadLibrary() {
  if (window.writeXlsxFile) return Promise.resolve(window.writeXlsxFile);
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIBRARY_URL;
      script.integrity = LIBRARY_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () => (window.writeXlsxFile ? resolve(window.writeXlsxFile) : reject(new Error("Biblioteca xlsx no disponible")));
      script.onerror = () => {
        libraryPromise = null; // permite reintentar si falló la red
        script.remove();
        reject(new Error("No se pudo cargar la biblioteca xlsx"));
      };
      document.head.append(script);
    });
  }
  return libraryPromise;
}

// El escudo es opcional: si no carga, la planilla sale igual sin la imagen.
async function loadLogo() {
  try {
    const response = await fetch(LOGO_URL);
    if (!response.ok) return null;
    return await response.blob();
  } catch (error) {
    return null;
  }
}

function textCell(value, style) {
  // Formato "@" (texto): Excel no convierte "241081" en número ni "6.1" en fecha.
  return { value: value === undefined || value === null ? "" : String(value), type: String, format: "@", ...style };
}

function numberCell(value, style) {
  return { value, type: Number, ...style };
}

function dateCell(dayKey, style) {
  return dayKey ? { value: excelDateSerial(dayKey), type: Number, format: DATE_FORMAT, ...style } : null;
}

function timeCell(seconds) {
  return seconds === null || seconds === undefined
    ? null
    : { value: excelTimeFraction(seconds), type: Number, format: TIME_FORMAT };
}

function emptyRow(width) {
  return new Array(width).fill(null);
}

function generatedLabel(nowMs, generatedBy) {
  const parts = bogotaParts(nowMs);
  const pad = (value) => String(value).padStart(2, "0");
  return pad(parts.day) + "/" + pad(parts.month) + "/" + parts.year + " " +
    pad(parts.hour) + ":" + pad(parts.minute) + " (hora de Colombia) por " + generatedBy;
}

function periodText(range) {
  if (range.start === range.end) return formatDayLong(range.start);
  return "del " + formatDayLong(range.start) + " al " + formatDayLong(range.end);
}

// Encabezado de cada día: el número (13, 14, 15…) o "13/10" si el periodo abarca dos meses.
function dayHeader(column, multiMonth) {
  return multiMonth ? column.number + "/" + Number(column.day.slice(5, 7)) : String(column.number);
}

function mergedColumnText(column) {
  if (column.state === "sin-clases") return "No hubo clase · " + column.noClass.motivo;
  return "Sin servicio (nadie registró almuerzo)";
}

function dayCell(cell) {
  const base = { ...BORDER, align: "center", alignVertical: "center", fontSize: 11 };
  if (cell.state === CELL.ASISTIO) return textCell(CHECK, { ...base, fontWeight: "bold", textColor: "#0B6E35" });
  if (cell.state === CELL.NO_ASISTIO) return textCell(CROSS, { ...base, fontWeight: "bold", textColor: "#B3261E" });
  if (cell.state === CELL.NO_APLICA) return textCell("–", { ...base, textColor: "#9E9E9E", backgroundColor: "#F2F2F2" });
  return textCell("", base);
}

/* Hoja de un grupo con el formato del listado impreso. */
export function planillaSheet(planilla, report, options) {
  const columns = planilla.columns;
  const width = FIXED_COLUMNS + columns.length;
  const wide = columns.length >= WIDE_LAYOUT_DAYS;
  const rightStart = wide ? width - WIDE_LAYOUT_DAYS : width;
  const leftSpan = Math.max(1, rightStart - 2);
  const multiMonth = report.range.start.slice(0, 7) !== report.range.end.slice(0, 7);
  const data = [];

  const put = (row, column, cell) => {
    while (data.length <= row) data.push(emptyRow(width));
    data[row][column] = cell;
  };

  // Escudo (imagen en A1), nombre de la institución en C y contacto a la derecha.
  put(0, 0, { value: "" });
  put(1, 2, textCell(INSTITUCION.tipo, { fontSize: 13, textColor: "#404040", columnSpan: leftSpan }));
  put(2, 2, textCell(INSTITUCION.nombre, { fontSize: 15, fontWeight: "bold", textColor: "#262626", columnSpan: leftSpan }));
  INSTITUCION.resoluciones.forEach((line, index) => {
    put(3 + index, 2, textCell(line, { fontSize: 7, textColor: "#595959", columnSpan: leftSpan }));
  });
  if (wide) {
    INSTITUCION.contacto.forEach((line, index) => {
      put(index, rightStart, textCell(line.texto, {
        fontSize: 8,
        fontWeight: line.negrita ? "bold" : undefined,
        textColor: "#404040",
        align: "right",
        columnSpan: WIDE_LAYOUT_DAYS
      }));
    });
  } else {
    const compact = INSTITUCION.contacto.map((line) => line.texto).join(" · ");
    put(3 + INSTITUCION.resoluciones.length, 2, textCell(compact, { fontSize: 7, textColor: "#595959", wrap: true, columnSpan: width - 2 }));
  }
  // Alturas compactas del encabezado, como en el listado impreso.
  const headerHeights = [12, 17, 19, 11, 11, 11, 11, wide ? 11 : 30];
  data.forEach((cells, index) => {
    const first = cells.find(Boolean);
    if (first && headerHeights[index]) first.height = headerHeights[index];
  });

  // Separadores bajos para que la planilla quepa en una hoja carta.
  put(data.length, 0, { value: "", height: 8 });
  let row = data.length;
  put(row, 0, textCell(INSTITUCION.titulo, { fontSize: 14, fontWeight: "bold", fontStyle: "italic", textColor: "#404040", columnSpan: width, height: 22 }));
  row += 1;
  put(row, 0, textCell("GRUPO: " + planilla.code + " - JORNADA: " + options.jornada, { fontSize: 11, fontWeight: "bold", columnSpan: width }));
  row += 1;
  put(row, 0, textCell(INSTITUCION.programa + " · Grupo " + planilla.group + " · Periodo " + periodText(report.range), {
    fontSize: 8,
    textColor: "#595959",
    columnSpan: width
  }));
  row += 1;
  put(row, 0, { value: "", height: 6 });
  row += 1;

  // Encabezado de la tabla.
  const headerRow = row;
  put(headerRow, 0, textCell("N°", { ...TABLE_HEADER, height: 18 }));
  put(headerRow, 1, textCell("MATRÍCULA", TABLE_HEADER));
  put(headerRow, 2, textCell("ESTUDIANTE", TABLE_HEADER));
  put(headerRow, 3, textCell("ESTADO", TABLE_HEADER));
  columns.forEach((column, index) => put(headerRow, FIXED_COLUMNS + index, textCell(dayHeader(column, multiMonth), TABLE_HEADER)));
  row += 1;

  // Estudiantes.
  const firstStudentRow = row;
  planilla.rows.forEach((student) => {
    const base = { ...BORDER, fontSize: 9, alignVertical: "center" };
    put(row, 0, numberCell(student.n, { ...base, align: "center", height: 15 }));
    put(row, 1, textCell(student.matricula, base));
    put(row, 2, textCell(student.nombre.toLocaleUpperCase("es-CO"), base));
    put(row, 3, textCell(student.estado, { ...base, fontSize: student.extra ? 7 : 9, textColor: student.extra ? "#7F7F7F" : undefined }));
    student.cells.forEach((cell, index) => {
      const column = columns[index];
      if (column.state === "sin-clases" || column.state === "sin-servicio") return;
      put(row, FIXED_COLUMNS + index, dayCell(cell));
    });
    row += 1;
  });

  // Días sin clases o sin servicio: una sola celda gris en vertical, como la nota «No hubo clase».
  if (planilla.rows.length) {
    columns.forEach((column, index) => {
      if (column.state !== "sin-clases" && column.state !== "sin-servicio") return;
      put(firstStudentRow, FIXED_COLUMNS + index, textCell(mergedColumnText(column), {
        ...BORDER,
        rowSpan: planilla.rows.length,
        textRotation: 90,
        align: "center",
        alignVertical: "center",
        wrap: true,
        fontSize: 8,
        textColor: "#404040",
        backgroundColor: column.state === "sin-clases" ? "#D9D9D9" : "#EDEDED"
      }));
    });
  } else {
    put(row, 0, textCell("Este grupo no tiene beneficiarios registrados en el PAE.", { fontSize: 9, fontStyle: "italic", columnSpan: width }));
    row += 1;
  }

  // Totales por día: raciones entregadas y ausencias.
  const totalLabel = { fontSize: 9, fontWeight: "bold", align: "right", columnSpan: FIXED_COLUMNS };
  const countable = (column) => column.state === "cerrado" || column.state === "en-curso";
  put(row, 0, textCell("Almorzaron (" + CHECK + ")", { ...totalLabel, height: 16 }));
  columns.forEach((column, index) => {
    put(row, FIXED_COLUMNS + index, countable(column)
      ? numberCell(planilla.totals[index].asistio, { ...BORDER, align: "center", fontSize: 9, fontWeight: "bold", textColor: "#0B6E35" })
      : textCell("", BORDER));
  });
  row += 1;
  put(row, 0, textCell("No asistieron (" + CROSS + ")", totalLabel));
  columns.forEach((column, index) => {
    put(row, FIXED_COLUMNS + index, column.state === "cerrado"
      ? numberCell(planilla.totals[index].noAsistio, { ...BORDER, align: "center", fontSize: 9, fontWeight: "bold", textColor: "#B3261E" })
      : textCell("", BORDER));
  });
  row += 1;
  // Número de estudiantes de la lista, como el «14» al pie del listado impreso.
  put(row, 0, textCell("Total de estudiantes", { fontSize: 10, align: "right", columnSpan: 3, height: 18 }));
  put(row, 3, numberCell(planilla.rows.length, { fontSize: 11, fontWeight: "bold", align: "center" }));
  row += 1;

  put(row, 0, textCell(
    CHECK + " = Asistió al almuerzo   " + CROSS + " = No asistió al almuerzo   Gris = no hubo clase o no hubo servicio   " +
      "En blanco = el día aún no termina   – = aún no estaba en el PAE",
    { fontSize: 8, textColor: "#404040", columnSpan: width }
  ));
  row += 1;
  put(row, 0, textCell(
    "Almuerzos con chip: " + planilla.porChip + " · Registrados a mano: " + planilla.manuales +
      " · Hora de cierre del almuerzo: " + options.cierreLabel + " · Generado el " + generatedLabel(options.nowMs, options.generatedBy),
    { fontSize: 7, textColor: "#7F7F7F", columnSpan: width }
  ));

  const sheet = {
    data,
    sheet: sheetName("Grupo " + planilla.group),
    showGridLines: false,
    orientation: columns.length > 12 ? "landscape" : "portrait",
    columns: [
      { width: 4.5 },
      { width: 10 },
      { width: 34 },
      { width: 11 },
      ...columns.map(() => ({ width: 4.3 }))
    ]
  };
  if (options.logo) {
    sheet.images = [{
      content: options.logo,
      contentType: "image/png",
      width: 58,
      height: 66,
      dpi: 96,
      anchor: { row: 1, column: 1 },
      offsetX: 6,
      offsetY: 4,
      title: "Escudo IERUU"
    }];
  }
  return sheet;
}

function sheetName(value) {
  return value.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
}

function percentCell(asistio, noAsistio, style) {
  const rate = attendanceRate(asistio, noAsistio);
  return rate === null ? textCell("—", style) : { value: rate, type: Number, format: "0.0%", ...style };
}

export function summarySheet(report, options) {
  const data = [
    [{ value: "IERUU · PAE · Asistencia al almuerzo (CCT)", fontWeight: "bold", fontSize: 14, textColor: "#404040" }],
    [{ value: "Periodo", fontWeight: "bold" }, textCell(report.range.label)],
    [{ value: "Desde", fontWeight: "bold" }, dateCell(report.range.start, { align: "left" })],
    [{ value: "Hasta", fontWeight: "bold" }, dateCell(report.range.end, { align: "left" })],
    [{ value: "Grupos", fontWeight: "bold" }, textCell(options.groupLabel)],
    [{ value: "Jornada", fontWeight: "bold" }, textCell(options.jornada)],
    [{ value: "Hora de cierre del almuerzo", fontWeight: "bold" }, textCell(options.cierreLabel)],
    [{ value: "Generado", fontWeight: "bold" }, textCell(generatedLabel(options.nowMs, options.generatedBy))],
    [],
    [
      "Grupo",
      "Código",
      "Beneficiarios",
      "Días de servicio",
      "Almorzaron (" + CHECK + ")",
      "Con chip",
      "Registro manual",
      "No asistieron (" + CROSS + ")",
      "% de asistencia"
    ].map((value) => ({ value, ...SUMMARY_HEADER }))
  ];
  report.planillas.forEach((planilla) => {
    data.push([
      textCell("Grupo " + planilla.group),
      textCell(planilla.code),
      numberCell(planilla.beneficiarios),
      numberCell(planilla.diasServicio),
      numberCell(planilla.asistio),
      numberCell(planilla.porChip),
      numberCell(planilla.manuales),
      numberCell(planilla.noAsistio),
      percentCell(planilla.asistio, planilla.noAsistio)
    ]);
  });
  const totals = report.totals;
  const bold = { fontWeight: "bold", topBorderStyle: "thin", topBorderColor: "#404040" };
  data.push([
    { value: "Total", ...bold },
    textCell("", bold),
    numberCell(totals.beneficiarios, bold),
    textCell("", bold),
    numberCell(totals.asistio, bold),
    numberCell(totals.porChip, bold),
    numberCell(totals.manuales, bold),
    numberCell(totals.noAsistio, bold),
    percentCell(totals.asistio, totals.noAsistio, bold)
  ]);
  data.push([]);
  data.push([textCell(
    "No cuentan como inasistencia los días sin clases del grupo, los días que nadie registró almuerzo (sin servicio), " +
      "los días que aún no terminan ni los días anteriores a la entrada del estudiante al PAE.",
    { fontSize: 9, textColor: "#595959" }
  )]);

  return {
    data,
    sheet: "Resumen",
    orientation: "landscape",
    columns: [{ width: 26 }, { width: 44 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 10 }, { width: 13 }, { width: 15 }, { width: 13 }]
  };
}

export function detailSheet(report) {
  const data = [[
    "Fecha",
    "Hora",
    "Matrícula",
    "Estudiante",
    "Grupo",
    "Registro",
    "Motivo del registro manual",
    "Registrado por",
    "Chip (UID)"
  ].map((value) => ({ value, ...SUMMARY_HEADER }))];
  report.detail.forEach((record) => {
    data.push([
      dateCell(record.fecha),
      timeCell(record.seconds),
      textCell(record.matricula),
      textCell(record.nombre),
      textCell(record.grupo),
      textCell(record.via === "manual" ? "Manual" : "Chip"),
      textCell(record.via === "manual" ? MANUAL_REASON_LABELS[record.motivo] || "Sin motivo" : ""),
      textCell(record.porNombre),
      textCell(record.chip)
    ]);
  });
  if (!report.detail.length) data.push([textCell("No hay almuerzos registrados en este periodo con los filtros elegidos.")]);
  return {
    data,
    sheet: "Detalle",
    orientation: "landscape",
    stickyRowsCount: 1,
    columns: [{ width: 12 }, { width: 10 }, { width: 12 }, { width: 38 }, { width: 8 }, { width: 10 }, { width: 26 }, { width: 26 }, { width: 18 }]
  };
}

export function buildWorkbook(report, options) {
  return [
    ...report.planillas.map((planilla) => planillaSheet(planilla, report, options)),
    summarySheet(report, options),
    detailSheet(report)
  ];
}

/* ---------- Impresión: tamaño carta y todas las columnas en una página de ancho ---------- */

// write-excel-file siempre pone papel A4 y no sabe «ajustar al ancho de la página». Se corrige en
// el XML de cada hoja: papel carta (paperSize 1, el de Colombia) y fitToWidth 1 / fitToHeight 0.
export function applyPrintSetup(xml) {
  let result = xml.replace(/<pageSetup\b([^>]*?)\/>/, (match, attributes) =>
    "<pageSetup" + attributes.replace(/\s(paperSize|fitToWidth|fitToHeight)="[^"]*"/g, "") +
      ' paperSize="1" fitToWidth="1" fitToHeight="0"/>');
  if (result !== xml && !/<sheetPr\b/.test(result)) {
    result = result.replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/*
 * Reescribe el .xlsx (un .zip) cambiando sólo el XML de las hojas; las demás partes se copian tal
 * cual. Si el navegador no tiene DecompressionStream, devuelve el archivo sin cambios (sólo cambia
 * cómo se imprime).
 */
export async function fitSheetsToPage(blob) {
  if (typeof DecompressionStream !== "function") return blob;
  const source = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  let end = source.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) return blob;

  const decoder = new TextDecoder();
  const entries = [];
  let offset = view.getUint32(end + 16, true);
  for (let index = view.getUint16(end + 10, true); index > 0; index -= 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const nameBytes = source.slice(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: decoder.decode(nameBytes),
      nameBytes,
      method: view.getUint16(offset + 10, true),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      crc: view.getUint32(offset + 16, true),
      compressedSize,
      size: view.getUint32(offset + 24, true),
      data: source.subarray(dataStart, dataStart + compressedSize)
    });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }

  for (const entry of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) continue;
    const xml = decoder.decode(entry.method === 8 ? await inflateRaw(entry.data) : entry.data);
    const changed = applyPrintSetup(xml);
    if (changed === xml) continue;
    const bytes = new TextEncoder().encode(changed);
    const packed = typeof CompressionStream === "function" ? await deflateRaw(bytes) : null;
    Object.assign(entry, {
      method: packed ? 8 : 0,
      data: packed || bytes,
      size: bytes.length,
      compressedSize: (packed || bytes).length,
      crc: crc32(bytes)
    });
  }

  const parts = [];
  const central = [];
  let position = 0;
  entries.forEach((entry) => {
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, entry.method, true);
    header.setUint16(10, entry.time, true);
    header.setUint16(12, entry.date, true);
    header.setUint32(14, entry.crc, true);
    header.setUint32(18, entry.compressedSize, true);
    header.setUint32(22, entry.size, true);
    header.setUint16(26, entry.nameBytes.length, true);
    parts.push(new Uint8Array(header.buffer), entry.nameBytes, entry.data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(10, entry.method, true);
    record.setUint16(12, entry.time, true);
    record.setUint16(14, entry.date, true);
    record.setUint32(16, entry.crc, true);
    record.setUint32(20, entry.compressedSize, true);
    record.setUint32(24, entry.size, true);
    record.setUint16(28, entry.nameBytes.length, true);
    record.setUint32(42, position, true);
    central.push(new Uint8Array(record.buffer), entry.nameBytes);
    position += 30 + entry.nameBytes.length + entry.data.length;
  });
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const footer = new DataView(new ArrayBuffer(22));
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, entries.length, true);
  footer.setUint16(10, entries.length, true);
  footer.setUint32(12, centralSize, true);
  footer.setUint32(16, position, true);
  return new Blob([...parts, ...central, new Uint8Array(footer.buffer)], { type: blob.type });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.style.display = "none";
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

export function fileNameFor(report, filters, nowMs) {
  const parts = bogotaParts(nowMs);
  const stamp = makeDayKey(parts.year, parts.month, parts.day);
  const scope = filters.group ? "grupo-" + filters.group : "todos-los-grupos";
  return "PAE-almuerzo_" + scope + "_" + report.range.fileTag + "_generado-" + stamp + ".xlsx";
}

/* options = { jornada, cierreLabel, generatedBy, groupLabel } */
export async function exportToXlsx(report, filters, options) {
  const [writeXlsxFile, logo] = await Promise.all([loadLibrary(), loadLogo()]);
  const nowMs = Date.now();
  const fileName = fileNameFor(report, filters, nowMs);
  const blob = await writeXlsxFile(buildWorkbook(report, { ...options, logo, nowMs }), { fontFamily: "Calibri", fontSize: 11 }).toBlob();
  let printable = blob;
  try {
    printable = await fitSheetsToPage(blob);
  } catch (error) {
    // El ajuste de impresión es opcional: si algo falla, se descarga la planilla tal cual.
    console.warn("No se pudo ajustar la impresión de la planilla", error);
  }
  downloadBlob(printable, fileName);
  return fileName;
}
