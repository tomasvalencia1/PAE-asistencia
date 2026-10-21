/*
 * Pruebas del bloque "pae" de database.rules.json con el emulador de Realtime Database.
 *
 * Ejecutar desde la carpeta tests (necesita Java 21+):
 *   npm install
 *   npm run test:rules
 *
 * Cubre el lector del restaurante (cuenta de rol lector), los tres roles del panel, la cuenta
 * inactiva, el acceso anónimo, la coherencia beneficiario ↔ chip y que nadie registre dos
 * almuerzos del mismo estudiante el mismo día.
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";

let env;

const DAY = "2026-10-20";
const CHIP = "04A1B2C3D4";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pae",
    database: { rules: readFileSync(new URL("../database.rules.json", import.meta.url), "utf8") }
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set({
      usuarios: {
        doc: { nombre: "Docente", rol: "docente", activo: true },
        doc2: { nombre: "Otra docente", rol: "docente", activo: true },
        dir: { nombre: "Directiva", rol: "directivo", activo: true },
        adm: { nombre: "Admin", rol: "admin", activo: true },
        off: { nombre: "Inactivo", rol: "directivo", activo: false },
        lec: { nombre: "Lector restaurante", rol: "lector", activo: true },
        lecoff: { nombre: "Lector perdido", rol: "lector", activo: false }
      },
      estudiantes: {
        [CHIP]: { nombre: "Andrea Álvarez Curequia", grupo: "6.1", llegadasTarde: 0 }
      },
      pae: {
        beneficiarios: {
          "241081": { matricula: "241081", nombre: "ALVAREZ CUREQUIA ANDREA", grupo: "6.1", estado: "ALMUERZO", orden: 1, chip: CHIP },
          "221096": { matricula: "221096", nombre: "DAVILA BOTERO MATHIAS ", grupo: "6.1", estado: "ALMUERZO", orden: 2 }
        },
        chips: { [CHIP]: "241081" },
        asistencia: {
          "2026-10-19": {
            "241081": chipRecord({ fecha: "2026-10-19" })
          }
        }
      }
    });
  });
});

const db = (uid) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());
const NOMBRES = { doc: "Docente", doc2: "Otra docente", dir: "Directiva", adm: "Admin" };

function chipRecord(overrides = {}) {
  return {
    matricula: "241081", nombre: "ALVAREZ CUREQUIA ANDREA", grupo: "6.1", fecha: DAY,
    hora: "12:05:30", timestamp: Date.now() - 60 * 1000, via: "chip", chip: CHIP,
    ...overrides
  };
}

function manualRecord(uid, overrides = {}, manualOverrides = {}) {
  return {
    matricula: "221096", nombre: "DAVILA BOTERO MATHIAS ", grupo: "6.1", fecha: DAY,
    hora: "12:06:00", timestamp: Date.now() - 60 * 1000, via: "manual",
    manual: { porUid: uid, porNombre: NOMBRES[uid], motivo: "sin-asignar", registradoEn: { ".sv": "timestamp" }, ...manualOverrides },
    ...overrides
  };
}

const chipPath = "pae/asistencia/" + DAY + "/241081";
const manualPath = "pae/asistencia/" + DAY + "/221096";

/* ---------- Lector del restaurante ---------- */

test("lector: lee el chip, la ficha y el almuerzo de hoy uno por uno, pero no lista nada", async () => {
  await assertSucceeds(db("lec").ref("pae/chips/" + CHIP).once("value"));
  await assertSucceeds(db("lec").ref("pae/beneficiarios/241081").once("value"));
  await assertSucceeds(db("lec").ref(chipPath).once("value"));
  await assertSucceeds(db("lec").ref("pae/diasSinClases").once("value"));
  await assertSucceeds(db("lec").ref("estudiantes/" + CHIP).once("value"));
  await assertFails(db("lec").ref("pae/chips").once("value"));
  await assertFails(db("lec").ref("pae/beneficiarios").once("value"));
  await assertFails(db("lec").ref("pae/asistencia").once("value"));
  await assertFails(db("lec").ref("pae/asistencia/" + DAY).once("value"));
});

test("lector: registra el almuerzo con el chip vinculado, una sola vez por día", async () => {
  await assertSucceeds(db("lec").ref(chipPath).set(chipRecord()));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ hora: "12:30:00" })));
  await assertFails(db("lec").ref(chipPath).remove());
});

test("lector: no puede usar un chip ajeno, copiar mal el nombre ni registrar a mano", async () => {
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ chip: "0000AAAA" })));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ nombre: "Andrea Álvarez" })));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ grupo: "6.2" })));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ fecha: "2026-10-21" })));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ extra: 1 })));
  await assertFails(db("lec").ref(chipPath).set(chipRecord({ timestamp: Date.now() + 3600 * 1000 })));
  // 221096 no tiene chip: el lector no puede crearle un registro con chip.
  await assertFails(db("lec").ref(manualPath).set(chipRecord({ matricula: "221096", nombre: "DAVILA BOTERO MATHIAS " })));
  await assertFails(db("lec").ref(manualPath).set({ ...manualRecord("doc"), manual: { porUid: "lec", porNombre: "Lector restaurante", motivo: "sin-chip", registradoEn: 1 } }));
  await assertFails(db("lec").ref("pae/asistencia/" + DAY + "/999999").set(chipRecord({ matricula: "999999" })));
});

test("lector: un registro guardado sin conexión días atrás también se acepta", async () => {
  await assertSucceeds(db("lec").ref(chipPath).set(chipRecord({ timestamp: Date.now() - 3 * 86400 * 1000 })));
});

test("sin sesión o con cuentas desactivadas no se registra ni se lee nada del PAE", async () => {
  for (const uid of [null, "lecoff", "off"]) {
    await assertFails(db(uid).ref(chipPath).set(chipRecord()));
    await assertFails(db(uid).ref("pae/chips/" + CHIP).once("value"));
    await assertFails(db(uid).ref("pae/beneficiarios").once("value"));
    await assertFails(db(uid).ref("pae/asistencia").once("value"));
  }
  await assertSucceeds(db(null).ref("pae/diasSinClases").once("value"));
  await assertSucceeds(db(null).ref("pae/config").once("value"));
});

/* ---------- Registro manual desde el panel ---------- */

test("docente, directivo y admin registran a mano a su nombre", async () => {
  await assertSucceeds(db("doc").ref(manualPath).set(manualRecord("doc")));
  for (const uid of ["dir", "adm"]) {
    const path = "pae/asistencia/2026-10-2" + (uid === "dir" ? "1" : "2") + "/221096";
    await assertSucceeds(db(uid).ref(path).set(manualRecord(uid, { fecha: path.slice(15, 25) }, { motivo: "sin-chip" })));
  }
});

test("registro manual: nombre de quien registra, motivo y hora válidos; sin campos extra", async () => {
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", {}, { porUid: "dir" })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", {}, { porNombre: "Otra persona" })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", {}, { motivo: "porque sí" })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", {}, { extra: true })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", { chip: CHIP })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", { timestamp: Date.now() - 2 * 86400 * 1000 })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", { hora: "25:00:00" })));
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", { nombre: "DAVILA BOTERO MATHIAS" })));
  await assertSucceeds(db("doc").ref(manualPath).set(manualRecord("doc")));
});

test("registro manual: una sola vez por estudiante y día, aunque lo intenten dos personas", async () => {
  await assertSucceeds(db("doc").ref(manualPath).set(manualRecord("doc")));
  await assertFails(db("doc2").ref(manualPath).set(manualRecord("doc2")));
  await assertFails(db("dir").ref(manualPath).set(manualRecord("dir")));
  // El que pasó el chip tampoco se puede registrar otra vez a mano.
  await assertSucceeds(db("lec").ref(chipPath).set(chipRecord()));
  await assertFails(db("doc").ref(chipPath).set(manualRecord("doc", { matricula: "241081", nombre: "ALVAREZ CUREQUIA ANDREA" })));
});

test("«corrección posterior» sólo la usan directivo y admin", async () => {
  await assertFails(db("doc").ref(manualPath).set(manualRecord("doc", {}, { motivo: "correccion" })));
  await assertSucceeds(db("dir").ref(manualPath).set(manualRecord("dir", {}, { motivo: "correccion" })));
});

test("quitar: cada quien deshace su registro manual; directivo y admin quitan cualquiera", async () => {
  await assertSucceeds(db("doc").ref(manualPath).set(manualRecord("doc")));
  await assertFails(db("doc2").ref(manualPath).remove());
  await assertSucceeds(db("doc").ref(manualPath).remove());

  await assertSucceeds(db("doc").ref(manualPath).set(manualRecord("doc")));
  await assertSucceeds(db("dir").ref(manualPath).remove());

  await assertSucceeds(db("lec").ref(chipPath).set(chipRecord()));
  await assertFails(db("doc").ref(chipPath).remove());
  await assertSucceeds(db("adm").ref(chipPath).remove());
});

test("un docente no puede deshacer su registro manual pasado un día", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(manualPath).set({
      ...manualRecord("doc"),
      manual: { porUid: "doc", porNombre: "Docente", motivo: "sin-asignar", registradoEn: Date.now() - 2 * 86400 * 1000 }
    });
  });
  await assertFails(db("doc").ref(manualPath).remove());
  await assertSucceeds(db("dir").ref(manualPath).remove());
});

/* ---------- Beneficiarios y chips ---------- */

const beneficiary = (overrides = {}) => ({ matricula: "201029", nombre: "HERNANDEZ FLOREZ YESSID", grupo: "6.1", estado: "ALMUERZO", orden: 3, ...overrides });

test("beneficiarios: todos los del panel los leen; sólo directivo y admin los escriben", async () => {
  await assertSucceeds(db("doc").ref("pae/beneficiarios").once("value"));
  await assertSucceeds(db("doc").ref("pae/chips").once("value"));
  await assertSucceeds(db("doc").ref("pae/asistencia").orderByKey().startAt("2026-10-01").endAt("2026-10-31").once("value"));
  await assertFails(db("doc").ref("pae/beneficiarios/201029").set(beneficiary()));
  await assertFails(db("lec").ref("pae/beneficiarios/201029").set(beneficiary()));
  for (const uid of ["dir", "adm"]) {
    await assertSucceeds(db(uid).ref("pae/beneficiarios/201029").set(beneficiary({ desde: "2026-10-20" })));
    await assertSucceeds(db(uid).ref("pae/beneficiarios/201029").remove());
  }
});

test("beneficiarios: matrícula, grupo, estado y orden válidos; sin campos extra", async () => {
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ matricula: "201030" })));
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ grupo: "12.1" })));
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ estado: "" })));
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ orden: "3" })));
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ desde: "20/10/2026" })));
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ extra: 1 })));
  await assertFails(db("dir").ref("pae/beneficiarios/abc 1").set(beneficiary({ matricula: "abc 1" })));
  const { estado, ...sinEstado } = beneficiary();
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(sinEstado));
});

test("chips: el beneficiario y el índice de chips se guardan juntos y deben coincidir", async () => {
  const NEW = "0A0B0C0D";
  // Sólo uno de los dos lados: no se acepta.
  await assertFails(db("dir").ref("pae/beneficiarios/201029").set(beneficiary({ chip: NEW })));
  await assertFails(db("dir").ref("pae/chips/" + NEW).set("201029"));
  // Ambos en la misma escritura: sí.
  await assertSucceeds(db("dir").ref().update({
    "pae/beneficiarios/201029": beneficiary({ chip: NEW }),
    ["pae/chips/" + NEW]: "201029"
  }));
  // Un chip no puede apuntar a quien tiene otro chip.
  await assertFails(db("dir").ref("pae/chips/0E0E0E0E").set("241081"));
  // Cambiar el chip: se quita el índice viejo y se crea el nuevo.
  await assertSucceeds(db("dir").ref().update({
    "pae/beneficiarios/201029/chip": "0F0F0F0F",
    ["pae/chips/" + NEW]: null,
    "pae/chips/0F0F0F0F": "201029"
  }));
  await assertFails(db("dir").ref("pae/chips/abc").set("201029"));
});

test("importar: muchas fichas y cambios de orden en una sola escritura", async () => {
  await assertSucceeds(db("adm").ref().update({
    "pae/beneficiarios/201029": beneficiary({ orden: 1 }),
    "pae/beneficiarios/211148": beneficiary({ matricula: "211148", nombre: "HERNANDEZ GOMEZ ALEJANDRO", orden: 2 }),
    "pae/beneficiarios/241081/orden": 3,
    "pae/beneficiarios/221096/orden": 4
  }));
  await assertFails(db("adm").ref("pae/beneficiarios/241081/orden").set(-1));
});

/* ---------- Días sin clases y hora de cierre ---------- */

const periodo = (uid) => ({ desde: "2026-10-12", hasta: "2026-10-12", motivo: "Festivo", grupos: "todos", creadoPorUid: uid, creadoEn: 1 });

test("días sin clases del PAE: todos los leen; sólo directivo y admin los marcan", async () => {
  await assertSucceeds(db(null).ref("pae/diasSinClases").once("value"));
  await assertFails(db("doc").ref("pae/diasSinClases/p1").set(periodo("doc")));
  await assertFails(db("lec").ref("pae/diasSinClases/p1").set(periodo("lec")));
  for (const uid of ["dir", "adm"]) {
    await assertSucceeds(db(uid).ref("pae/diasSinClases/p1").set(periodo(uid)));
    await assertSucceeds(db(uid).ref("pae/diasSinClases/p1").remove());
  }
  await assertFails(db("dir").ref("pae/diasSinClases/p2").set({ ...periodo("dir"), grupos: "12.1" }));
  await assertFails(db("dir").ref("pae/diasSinClases/p2").set({ ...periodo("dir"), creadoPorUid: "adm" }));
  // Marcar días sin clases en el PAE no toca los del panel de llegadas tarde.
  await assertFails(db("dir").ref("pae/diasSinClases/p3").set({ ...periodo("dir"), extra: true }));
});

test("hora de cierre: la leen todos; sólo directivo y admin la cambian, con formato HH:MM:SS", async () => {
  await assertSucceeds(db("doc").ref("pae/config/cierre").once("value"));
  await assertFails(db("doc").ref("pae/config/cierre").set("13:30:00"));
  await assertSucceeds(db("dir").ref("pae/config/cierre").set("13:30:00"));
  await assertFails(db("dir").ref("pae/config/cierre").set("1:30 p. m."));
  await assertFails(db("dir").ref("pae/config/otra").set("x"));
});

test("el PAE no puede escribir en los datos del sistema de llegadas tarde por su cuenta", async () => {
  // Las reglas de llegadas tarde siguen iguales: un docente no crea fichas ni días sin clases allí.
  await assertFails(db("doc").ref("estudiantes/0A0B0C0D").set({ nombre: "X", grupo: "6.1", llegadasTarde: 0 }));
  await assertFails(db("doc").ref("config/diasSinClases/p1").set(periodo("doc")));
  await assertFails(db("lec").ref("pae").once("value"));
});
