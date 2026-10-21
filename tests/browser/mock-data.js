/*
 * Datos de prueba para la vista previa (serve-preview.mjs). Las fechas se calculan a partir de
 * hoy en Colombia para que «Hoy» siempre tenga almuerzos. ?rol=docente entra como docente.
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  const rol = params.get("rol") === "docente" ? "uid-docente" : "uid-directivo";
  const dayKey = (offset) => {
    const date = new Date(Date.now() - 5 * 3600 * 1000 + offset * 86400000);
    return date.toISOString().slice(0, 10);
  };
  const weekdaysBack = [];
  for (let offset = -1; weekdaysBack.length < 8; offset -= 1) {
    const day = dayKey(offset);
    const weekday = new Date(day + "T12:00:00Z").getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdaysBack.push(day);
  }
  const listado = [
    ["241081", "ALVAREZ CUREQUIA ANDREA"], ["221096", "DAVILA BOTERO MATHIAS"], ["201029", "HERNANDEZ FLOREZ YESSID"],
    ["211148", "HERNANDEZ GOMEZ ALEJANDRO"], ["211147", "HERNANDEZ GOMEZ SALOME"], ["241067", "LOBO HOYOS THOMAS DAVID"],
    ["201040", "LOPEZ MORA PAULINA"], ["201160", "MARTINEZ CASTAÑO CELESTE"], ["260008", "MESA PANIAGUA LAUREN"],
    ["201023", "NARVAEZ RIAÑO SALOME"], ["211041", "PEREZ ARREDONDO JUAN FELIPE"], ["201180", "RESTREPO RAMIREZ TIFANY EXTRELLA"],
    ["211066", "ROJAS PEREZ SALOME"], ["260034", "JARAMILLO MEDINA CELESTE"]
  ];
  const beneficiarios = {};
  const chips = {};
  listado.forEach(([matricula, nombre], index) => {
    const item = { matricula, nombre, grupo: "6.1", estado: "ALMUERZO", orden: index + 1 };
    if (index % 4 !== 1) {
      item.chip = "0A0B0C" + String(index).padStart(2, "0");
      chips[item.chip] = matricula;
    }
    beneficiarios[matricula] = item;
  });
  [["300001", "GOMEZ RUIZ ANA SOFIA"], ["300002", "OSPINA MUÑOZ JUAN DAVID"], ["300003", "ZULUAGA PEÑA MARIA JOSE"]].forEach(([matricula, nombre], index) => {
    beneficiarios[matricula] = { matricula, nombre, grupo: "7.2", estado: "ALMUERZO", orden: index + 1 };
  });

  const record = (matricula, nombre, grupo, fecha, hora, manual) => ({
    matricula, nombre, grupo, fecha, hora, timestamp: Date.now(),
    ...(manual
      ? { via: "manual", manual: { porUid: "uid-docente", porNombre: "Docente Prueba", motivo: "sin-chip", registradoEn: Date.now() } }
      : { via: "chip", chip: beneficiarios[matricula].chip })
  });
  const asistencia = {};
  weekdaysBack.forEach((day, dayIndex) => {
    asistencia[day] = {};
    listado.forEach(([matricula, nombre], index) => {
      if ((index + dayIndex) % 7 === 3) return; // algunas ausencias
      asistencia[day][matricula] = record(matricula, nombre, "6.1", day, "12:0" + (index % 10) + ":00", !beneficiarios[matricula].chip);
    });
  });
  const today = dayKey(0);
  asistencia[today] = {};
  listado.slice(0, 6).forEach(([matricula, nombre], index) => {
    asistencia[today][matricula] = record(matricula, nombre, "6.1", today, "11:5" + index + ":00", !beneficiarios[matricula].chip);
  });

  window.__MOCK = {
    latencyMs: 120,
    user: { uid: rol, email: rol + "@ieruu.test" },
    loginAs: { uid: rol, email: rol + "@ieruu.test" },
    db: {
      usuarios: {
        "uid-docente": { nombre: "Docente Prueba", rol: "docente", activo: true },
        "uid-directivo": { nombre: "Directiva Prueba", rol: "directivo", activo: true }
      },
      estudiantes: {
        "AAAA0001": { nombre: "Ana Sofía Gómez Ruiz", grupo: "7.2", llegadasTarde: 0 },
        "AAAA0002": { nombre: "Juan David Ospina", grupo: "7.2", llegadasTarde: 0 }
      },
      config: {
        diasSinClases: {
          festivo: { desde: weekdaysBack[5], hasta: weekdaysBack[5], motivo: "Festivo", grupos: "todos", creadoPorUid: "x", creadoEn: 1 }
        }
      },
      pae: { beneficiarios, chips, asistencia, config: { cierre: "14:00:00" } }
    }
  };
})();
