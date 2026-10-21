# IERUU · Asistencia al almuerzo PAE (Comida Caliente Transportada)

Panel web para registrar quién almuerza en el restaurante escolar con el Programa de Alimentación Escolar (PAE), modalidad **Comida Caliente Transportada (CCT)**, y descargar la planilla de cada grupo en Excel con el formato del «Listado de grupo con número de orden» del colegio.

Es una copia adaptada de [Asistencia_RUU_PROFES](https://github.com/tomasvalencia1/Asistencia_RUU_PROFES) (panel de llegadas tarde). Usa **el mismo proyecto de Firebase y las mismas cuentas**, pero guarda todo lo suyo aparte, en `/pae`, para no interferir con ese sistema.

## Cómo se usa en el restaurante

- **Con chip:** el estudiante acerca su chip al teléfono con la app **PAE IERUU** (archivo `PAE_RUU_1.0.apk`). Queda «asistió al almuerzo» y aparece en el panel al instante.
- **Sin chip (lo más rápido):**
  - escribe parte del nombre o la matrícula en el buscador y pulsa **Enter**: si hay un solo resultado, queda marcado y el buscador queda listo para el siguiente; o
  - elige el grupo y **toca el nombre** del estudiante.
  - Aparece un aviso con **Deshacer** por si fue un error. Cada quien puede quitar sus propios registros manuales durante un día; directivo y administrador pueden quitar cualquiera.
- **«No asistió al almuerzo»:** desde la **hora de cierre del almuerzo** (2:00 p. m. por defecto; se cambia en «Beneficiarios › Hora de cierre»), quien no tiene registro de hoy —ni con chip ni a mano— queda como **no asistió**, en el panel y en el Excel. Antes de esa hora aparece como «sin registro». Los días anteriores ya cerrados siempre muestran quién no asistió.
- No se marca a nadie como «no asistió» en los **días sin clases** de su grupo, en los días que **nadie del colegio registró almuerzo** (no hubo servicio) ni antes de la fecha en que el estudiante **entró al PAE**.
- Un estudiante sólo puede tener **un almuerzo por día**: ni el lector ni el panel registran dos (lo exigen también las reglas de Firebase, aunque lo intenten dos teléfonos a la vez).

## Roles (los mismos del panel de llegadas tarde)

| Rol | Marca almuerzos | Corrige días anteriores | Beneficiarios, chips, días sin clases y hora de cierre |
| --- | --- | --- | --- |
| Docente | Sí, sólo el de hoy | No | No (sólo los consulta) |
| Directivo | Sí | Sí («corrección posterior») | Sí |
| Administrador | Sí | Sí | Sí |
| Lector (teléfono del restaurante) | Sólo con el chip, desde la APK | No | No |

## Planilla de Excel

**Descargar Excel del mes** (botón verde de cada grupo) descarga **de un clic**, sin abrir nada más, la planilla del mes del grupo que se está viendo. **Informes y Excel** sirve para otros periodos o para todos los grupos a la vez. El `.xlsx` trae:

- **Una hoja por grupo** con el formato del listado impreso: escudo, «INSTITUCIÓN EDUCATIVA RAFAEL URIBE URIBE», resoluciones, sedes y contacto, «Listado de grupo con número de orden», «GRUPO: 060100 - JORNADA: Mañana» y la tabla **N° · MATRÍCULA · ESTUDIANTE · ESTADO** con **una columna por cada día de clase** del periodo:
  - **✓** = asistió al almuerzo · **X** = no asistió al almuerzo;
  - **columna gris en vertical** = no hubo clase (con el motivo, como «No hubo clase · Festivo») o no hubo servicio;
  - en blanco = el día aún no termina.
  - Al pie: almorzaron y no asistieron por día, y el total de estudiantes.
  - Sale lista para imprimir: tamaño carta, horizontal si hay muchos días, todas las columnas en una página de ancho.
- Hoja **Resumen**: beneficiarios, días de servicio, raciones entregadas (con chip y a mano), inasistencias y % de asistencia por grupo.
- Hoja **Detalle**: cada almuerzo con fecha, hora, matrícula, estudiante, grupo, si fue con chip o a mano, motivo y quién lo registró.

Periodos: hoy, esta semana, este mes, mes anterior, otro día, otra semana, otro mes y **rango de fechas** (hasta 62 días). La jornada («Mañana») se escribe al descargar y el navegador la recuerda. Los datos del encabezado del colegio están en [`institucion.js`](institucion.js): revisa los números de las resoluciones, el NIT y el DANE, que se copiaron de la foto del listado.

## Beneficiarios (directivo y administrador)

Botón **Beneficiarios**:

1. **Importar el listado oficial:** copia las filas del «Listado de grupo con número de orden» desde Excel o el PDF y pégalas. Columnas: Matrícula, Estudiante y, si las tienes, Estado y Grupo (acepta «6.1» o el código «060100»). El orden en que se pegan es el **número de orden** de la planilla. Si una matrícula ya existe, se actualiza (conserva su chip).
2. **Vincular chips automáticamente:** busca la tarjeta de cada beneficiario sin chip entre las fichas del sistema de llegadas tarde (mismo nombre, sin importar tildes ni el orden de las palabras, y mismo grupo). Se revisa la lista antes de vincular.
3. **Hora de cierre del almuerzo.**

Con **Añadir beneficiario** o **Editar** (en cada fila) se escribe a mano la matrícula, el nombre, el grupo, el estado («ALMUERZO»), la fecha desde la que recibe almuerzo y el chip. Si el lector muestra «Chip no vinculado al PAE», toca «Copiar código» y pégalo en el campo **Chip**.

## Días sin clases (se conserva)

El botón **Días sin clases** funciona igual que en el panel de llegadas tarde: calendario, todos los grupos o sólo algunos, y motivo. En esos días no se registran almuerzos, nadie queda como «no asistió», el lector del restaurante muestra «Hoy no hay clases» y la planilla deja la columna en gris. Se guardan en `pae/diasSinClases`; los días que ya están marcados en el panel de llegadas tarde (`config/diasSinClases`) **también cuentan** aquí, pero sólo se pueden quitar desde ese panel.

## Datos en Firebase (todos nuevos, bajo `/pae`)

    pae/beneficiarios/<matrícula>
      matricula: "241081", nombre: "ALVAREZ CUREQUIA ANDREA", grupo: "6.1",
      estado: "ALMUERZO", orden: 1, desde: "2026-10-13" (opcional), chip: "04A1B2C3D4" (opcional)

    pae/chips/<UID del chip>: "241081"           (el lector del restaurante busca aquí)

    pae/asistencia/<AAAA-MM-DD>/<matrícula>
      matricula, nombre, grupo, fecha, hora: "12:05:30", timestamp,
      via: "chip"  → chip: "04A1B2C3D4"
      via: "manual" → manual: { porUid, porNombre, motivo: sin-chip | sin-asignar | correccion, registradoEn }

    pae/diasSinClases/<id>   { desde, hasta, motivo, grupos, creadoPorUid, creadoEn }
    pae/config/cierre        "14:00:00"

Sólo se **leen** (nunca se escriben): `usuarios` (rol), `config/diasSinClases` y `estudiantes` (para proponer chips).

## Publicar (GitHub + Vercel)

1. **Reglas de Firebase primero.** `database.rules.json` contiene **las reglas actuales del panel de llegadas tarde, sin cambios, más el bloque `pae`**. Publícalas:

       firebase deploy --only database --project ieruu-asistencia

   o cópialas en Firebase Console › Realtime Database › Reglas › Publicar. **Importante:** si después alguien publica las reglas desde el repositorio de llegadas tarde, borraría el bloque `pae`. Para evitarlo, copia el bloque `"pae": {…}` de este `database.rules.json` dentro de `"rules"` en el `database.rules.json` de ese repositorio.
2. Crea un repositorio nuevo en GitHub (por ejemplo `Asistencia_PAE_RUU`) y sube **todo el contenido de esta carpeta** (incluido `.gitattributes`: evita que Windows cambie la librería de Excel y rompa su verificación de integridad).
3. En Vercel: **Add New › Project**, importa el repositorio y pulsa **Deploy**. No hay paso de compilación (sitio estático). `.vercelignore` deja por fuera las pruebas, las reglas y la documentación.
4. Opcional: añade el dominio de Vercel en Firebase Console › Authentication › Settings › Authorized domains.
5. Para el teléfono del restaurante crea una cuenta con rol **Lector** desde el botón «Usuarios» del panel de llegadas tarde (o usa una cuenta de docente).

## Ejecutar en el computador

No abras `index.html` con doble clic. Usa un servidor local (`python -m http.server 8080` o la extensión Live Server) y abre http://localhost:8080.

Para probar sin tocar Firebase: `node tests/browser/serve-preview.mjs` y abre http://localhost:8790 (directivo) o http://localhost:8790/?rol=docente. Usa datos de prueba y un Firebase simulado.

## Pruebas automatizadas

Están en `tests` y no se publican.

| Prueba | Qué verifica | Cómo ejecutarla |
| --- | --- | --- |
| `query.test.mjs` | Fechas en Colombia, periodos, estado de cada día y casilla (asistió / no asistió / sin clases / sin servicio), planilla por grupo, importación de listados y vinculación de chips | `cd tests && npm run test:query` |
| `export.test.mjs` | Genera un `.xlsx` real y revisa formato, celdas combinadas, ✓/X, escudo, tamaño carta y ajuste a una página (deja `tests/out/ejemplo-planilla-PAE.xlsx`) | `cd tests && npm run test:query` |
| `rules-pae.test.mjs` | Reglas del bloque `pae` por rol, lector, cuentas inactivas, coherencia beneficiario ↔ chip y un solo almuerzo por día | `cd tests && npm install && npm run test:rules` (requiere Java 21) |
| `rules-llegadas.test.mjs` | Las reglas del sistema de llegadas tarde siguen funcionando igual con el archivo combinado | igual que la anterior |
