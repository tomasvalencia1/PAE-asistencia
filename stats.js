/*
 * Vista «Informes y Excel» del almuerzo PAE.
 *
 * Disponible para todos los roles. Descarga de Firebase sólo los días del periodo elegido
 * (pae/asistencia/<día>) y calcula todo con runReport(); la planilla de Excel usa ese mismo
 * resultado, así que el archivo y la pantalla siempre coinciden.
 */

import {
  CELL,
  GROUPS,
  attendanceRate,
  clockLabel,
  formatDayShort,
  monthKeyOf,
  monthOptions,
  periodRange,
  runReport,
  todayKey
} from "./query.js";
import { CHECK, CROSS } from "./export-xlsx.js";
import { INSTITUCION } from "./institucion.js";

const JORNADA_STORAGE_KEY = "ieruu.pae.jornada";

function element(tagName, className, content) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function percentLabel(asistio, noAsistio) {
  const rate = attendanceRate(asistio, noAsistio);
  return rate === null ? "—" : (rate * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " %";
}

// Jornada que sale en la planilla («Mañana»): la última que se escribió en este navegador.
export function savedJornada() {
  try {
    return window.localStorage.getItem(JORNADA_STORAGE_KEY) || INSTITUCION.jornada;
  } catch (error) {
    return INSTITUCION.jornada;
  }
}

function rememberJornada(value) {
  try {
    window.localStorage.setItem(JORNADA_STORAGE_KEY, value);
  } catch (error) {
    // No es necesario recordarlo para descargar el Excel.
  }
}

/*
 * options = {
 *   getContext(): { beneficiaries, noClass, today, nowSeconds, cierreSeconds, cierre },
 *   loadAttendance(range, force): Promise<Map día → Map matrícula → registro>,
 *   onExport(report, filters, extra): Promise<nombre del archivo>
 * }
 */
export function createStatsView(options) {
  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    dialog: $("#statsDialog"),
    form: $("#statsForm"),
    periodInputs: [...document.querySelectorAll("input[name='statsPeriod']")],
    dayField: $("#statsDayField"),
    dayInput: $("#statsDayInput"),
    weekField: $("#statsWeekField"),
    weekInput: $("#statsWeekInput"),
    monthField: $("#statsMonthField"),
    monthInput: $("#statsMonthInput"),
    rangeField: $("#statsRangeField"),
    fromInput: $("#statsFromInput"),
    toInput: $("#statsToInput"),
    groupInput: $("#statsGroupInput"),
    jornadaInput: $("#statsJornadaInput"),
    refreshButton: $("#statsRefreshButton"),
    rangeLabel: $("#statsRangeLabel"),
    asistio: $("#statsAsistio"),
    noAsistio: $("#statsNoAsistio"),
    beneficiarios: $("#statsBeneficiarios"),
    rate: $("#statsRate"),
    groupTableBody: $("#statsGroupTableBody"),
    groupTableFoot: $("#statsGroupTableFoot"),
    previewSection: $("#statsPreviewSection"),
    previewTitle: $("#statsPreviewTitle"),
    preview: $("#statsPreview"),
    exportButton: $("#statsExportButton"),
    exportStatus: $("#statsExportStatus")
  };

  const view = { lastReport: null, lastFilters: null, request: 0 };

  function populateStaticOptions() {
    nodes.groupInput.replaceChildren(new Option("Todos los grupos (una hoja por grupo)", ""));
    GROUPS.forEach((group) => nodes.groupInput.append(new Option("Grupo " + group, group)));
    const current = nodes.monthInput.value || monthKeyOf(todayKey());
    nodes.monthInput.replaceChildren();
    monthOptions().forEach((option) => nodes.monthInput.append(new Option(option.label, option.value)));
    nodes.monthInput.value = current;
    if (nodes.monthInput.value !== current) nodes.monthInput.selectedIndex = 0;
    nodes.jornadaInput.value = savedJornada();
  }

  function selectedPeriodType() {
    const checked = nodes.periodInputs.find((input) => input.checked);
    return checked ? checked.value : "mes";
  }

  function currentSpec() {
    const type = selectedPeriodType();
    if (type === "dia") return { type, value: nodes.dayInput.value };
    if (type === "semana-de") return { type, value: nodes.weekInput.value };
    if (type === "mes-de") return { type, value: nodes.monthInput.value };
    if (type === "rango") return { type, value: { from: nodes.fromInput.value, to: nodes.toInput.value } };
    return { type };
  }

  function syncPickers() {
    const type = selectedPeriodType();
    nodes.dayField.hidden = type !== "dia";
    nodes.weekField.hidden = type !== "semana-de";
    nodes.monthField.hidden = type !== "mes-de";
    nodes.rangeField.hidden = type !== "rango";
  }

  function groupRow(cells, cellTag) {
    const row = element("tr");
    cells.forEach((value, index) => {
      const cell = element(index === 0 ? "th" : cellTag, index === 0 ? "" : "numeric", String(value));
      if (index === 0) cell.scope = "row";
      row.append(cell);
    });
    return row;
  }

  function renderGroupTable(report) {
    nodes.groupTableBody.replaceChildren();
    if (!report.planillas.length) {
      const emptyRow = element("tr");
      const cell = element("td", "stats-table-empty", "No hay beneficiarios ni almuerzos en este periodo.");
      cell.colSpan = 7;
      emptyRow.append(cell);
      nodes.groupTableBody.append(emptyRow);
    }
    report.planillas.forEach((planilla) => {
      nodes.groupTableBody.append(groupRow([
        "Grupo " + planilla.group,
        planilla.beneficiarios,
        planilla.asistio,
        planilla.porChip,
        planilla.manuales,
        planilla.noAsistio,
        percentLabel(planilla.asistio, planilla.noAsistio)
      ], "td"));
    });
    const totals = report.totals;
    nodes.groupTableFoot.replaceChildren(groupRow([
      "Total",
      totals.beneficiarios,
      totals.asistio,
      totals.porChip,
      totals.manuales,
      totals.noAsistio,
      percentLabel(totals.asistio, totals.noAsistio)
    ], "th"));
  }

  // Vista previa de la planilla del grupo, igual a la hoja del Excel.
  function renderPreview(report, filters) {
    const planilla = filters.group ? report.planillas[0] : null;
    nodes.previewSection.hidden = !planilla;
    nodes.preview.replaceChildren();
    if (!planilla) return;
    nodes.previewTitle.textContent = "Planilla del grupo " + planilla.group + " · código " + planilla.code;

    const table = element("table", "planilla-table");
    const head = element("tr");
    ["N°", "MATRÍCULA", "ESTUDIANTE", "ESTADO"].forEach((label) => head.append(element("th", "", label)));
    planilla.columns.forEach((column) => {
      const th = element("th", "planilla-day", String(column.number));
      th.title = formatDayShort(column.day);
      head.append(th);
    });
    const thead = element("thead");
    thead.append(head);
    const tbody = element("tbody");
    planilla.rows.forEach((row) => {
      const tr = element("tr", row.extra ? "is-extra" : "");
      tr.append(element("td", "numeric", String(row.n)));
      tr.append(element("td", "", row.matricula));
      tr.append(element("td", "planilla-name", row.nombre));
      tr.append(element("td", "planilla-estado", row.estado));
      row.cells.forEach((cell, index) => {
        const column = planilla.columns[index];
        const td = element("td", "planilla-cell cell-" + cell.state);
        if (column.state === "sin-clases" || column.state === "sin-servicio") td.classList.add("cell-off");
        if (cell.state === CELL.ASISTIO) td.textContent = CHECK;
        else if (cell.state === CELL.NO_ASISTIO) td.textContent = CROSS;
        else if (cell.state === CELL.NO_APLICA) td.textContent = "–";
        td.title = formatDayShort(column.day) + ": " + cellTitle(cell, column);
        tr.append(td);
      });
      tbody.append(tr);
    });
    if (!planilla.rows.length) {
      const tr = element("tr");
      const td = element("td", "stats-table-empty", "Este grupo no tiene beneficiarios registrados.");
      td.colSpan = 4 + planilla.columns.length;
      tr.append(td);
      tbody.append(tr);
    }
    const tfoot = element("tfoot");
    const totalRow = element("tr");
    const label = element("th", "", "Almorzaron");
    label.colSpan = 4;
    totalRow.append(label);
    planilla.columns.forEach((column, index) => {
      const counts = column.state === "cerrado" || column.state === "en-curso";
      totalRow.append(element("td", "numeric", counts ? String(planilla.totals[index].asistio) : ""));
    });
    tfoot.append(totalRow);
    table.append(thead, tbody, tfoot);
    nodes.preview.append(table);
  }

  function cellTitle(cell, column) {
    if (cell.state === CELL.ASISTIO) {
      return "almorzó a las " + clockLabel(cell.record.hora) + " (" + cell.record.registro + ")";
    }
    if (cell.state === CELL.NO_ASISTIO) return "no asistió al almuerzo";
    if (cell.state === CELL.SIN_CLASES) return "sin clases (" + (column.noClass ? column.noClass.motivo : "") + ")";
    if (cell.state === CELL.SIN_SERVICIO) return "nadie registró almuerzo ese día";
    if (cell.state === CELL.PENDIENTE) return "sin registro (el almuerzo aún no cierra)";
    if (cell.state === CELL.NO_APLICA) return "aún no estaba en el PAE";
    return "día por venir";
  }

  function setLoading(message, isError) {
    nodes.rangeLabel.textContent = message;
    nodes.rangeLabel.classList.toggle("is-error", Boolean(isError));
  }

  async function refresh(force) {
    if (!nodes.dialog.open) return;
    syncPickers();
    const range = periodRange(currentSpec());
    const filters = { group: nodes.groupInput.value };
    const requestId = view.request + 1;
    view.request = requestId;
    nodes.exportButton.disabled = true;
    setLoading("Consultando " + range.label.toLocaleLowerCase("es-CO") + "…");
    let attendance;
    try {
      attendance = await options.loadAttendance(range, force);
    } catch (error) {
      if (view.request !== requestId) return;
      console.error("No fue posible consultar la asistencia del periodo", error);
      setLoading("No se pudo consultar la asistencia. Revisa Internet y pulsa «Actualizar».", true);
      return;
    }
    if (view.request !== requestId || !nodes.dialog.open) return;
    const context = { ...options.getContext(), attendance };
    const report = runReport(range, filters, context);
    view.lastReport = report;
    view.lastFilters = filters;

    setLoading(
      range.label + (range.capped ? " (máximo 62 días)" : "") + " · " + report.days.length +
        (report.days.length === 1 ? " día" : " días") + " de clase · zona horaria de Colombia"
    );
    nodes.asistio.textContent = String(report.totals.asistio);
    nodes.noAsistio.textContent = String(report.totals.noAsistio);
    nodes.beneficiarios.textContent = String(report.totals.beneficiarios);
    nodes.rate.textContent = percentLabel(report.totals.asistio, report.totals.noAsistio);
    renderGroupTable(report);
    renderPreview(report, filters);
    nodes.exportButton.disabled = false;
  }

  /* preset opcional: { period, group } para abrir directamente, por ejemplo, el mes de un grupo. */
  function open(preset) {
    const today = todayKey();
    [nodes.dayInput, nodes.weekInput, nodes.fromInput, nodes.toInput].forEach((input) => {
      if (!input.value) input.value = today;
      input.max = today;
    });
    if (preset && preset.period) {
      nodes.periodInputs.forEach((input) => { input.checked = input.value === preset.period; });
    }
    if (preset && preset.group !== undefined) nodes.groupInput.value = preset.group;
    nodes.exportStatus.textContent = "";
    nodes.exportStatus.classList.remove("error");
    if (typeof nodes.dialog.showModal === "function") nodes.dialog.showModal();
    refresh(false);
  }

  async function exportCurrent() {
    if (!view.lastReport) return;
    const jornada = nodes.jornadaInput.value.trim() || INSTITUCION.jornada;
    rememberJornada(jornada);
    nodes.exportButton.disabled = true;
    nodes.exportStatus.classList.remove("error");
    nodes.exportStatus.textContent = "Preparando la planilla…";
    try {
      const fileName = await options.onExport(view.lastReport, view.lastFilters, { jornada });
      nodes.exportStatus.textContent = "Descargado: " + fileName;
    } catch (error) {
      console.error("No fue posible generar el Excel", error);
      nodes.exportStatus.classList.add("error");
      nodes.exportStatus.textContent = "No se pudo generar el archivo. Revisa tu conexión e inténtalo de nuevo.";
    } finally {
      nodes.exportButton.disabled = false;
    }
  }

  populateStaticOptions();
  nodes.form.addEventListener("submit", (event) => event.preventDefault());
  nodes.form.addEventListener("change", (event) => {
    if (event.target === nodes.jornadaInput) return;
    refresh(false);
  });
  nodes.refreshButton.addEventListener("click", () => refresh(true));
  nodes.exportButton.addEventListener("click", exportCurrent);

  return {
    open,
    // Se llama cuando cambian los beneficiarios o los días sin clases con el informe abierto.
    refresh: () => refresh(false),
    isOpen: () => nodes.dialog.open
  };
}
