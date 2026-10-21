/*
 * Datos del encabezado de la planilla de Excel («Listado de grupo con número de orden»).
 *
 * Se copiaron del listado impreso del colegio. Si cambian (o alguna cifra quedó mal leída),
 * corrígelos aquí: es el único lugar donde están.
 */
export const INSTITUCION = {
  tipo: "INSTITUCIÓN EDUCATIVA",
  nombre: "RAFAEL URIBE URIBE",
  // Líneas pequeñas debajo del nombre.
  resoluciones: [
    "Resolución Creación: 16293 del 27 de noviembre de 2002",
    "Modificada por la Resolución 18639 del 25 de febrero del 2016",
    "Modificada por la Resolución 50021 del 18 de julio del 2018",
    "NIT: 811.018985-0 · DANE: 105001002020"
  ],
  // Bloque de la derecha. negrita: true para los títulos.
  contacto: [
    { texto: "Sede principal", negrita: true },
    { texto: "Carrera 82 N°42C-56" },
    { texto: "Sede escuela", negrita: true },
    { texto: "Carrera 83 No 42C - 54" },
    { texto: "Teléfonos 250 82 52 • 411 61 87" },
    { texto: "E-mail info@ierafaeluribe.edu.co" },
    { texto: "www.ierafaeluribe.edu.co", negrita: true },
    { texto: "Núcleo 930" }
  ],
  titulo: "Listado de grupo con número de orden",
  // Se puede cambiar al descargar el Excel; el navegador recuerda el último valor.
  jornada: "Mañana",
  programa: "Programa de Alimentación Escolar (PAE) · Modalidad Comida Caliente Transportada (CCT)"
};
