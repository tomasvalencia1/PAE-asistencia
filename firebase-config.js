/*
 * Configuración pública del proyecto Firebase del PAE (pae-asistencia).
 *
 * El apiKey de Firebase identifica el proyecto en el cliente; no es una contraseña. La seguridad
 * real está en Firebase Authentication y en las reglas de Realtime Database (database.rules.json).
 *
 * databaseURL no viene en el fragmento que muestra Firebase Console al registrar la app web, pero
 * Realtime Database la necesita. Es la dirección que aparece arriba de los datos en Firebase Console
 * › Realtime Database. Si la base se creó en otra región, la dirección termina en
 * «.firebasedatabase.app»: cópiala aquí tal cual.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAof6XKeS5q3P01AWovBXsaPRCajNqW6Us",
  authDomain: "pae-asistencia.firebaseapp.com",
  databaseURL: "https://pae-asistencia-default-rtdb.firebaseio.com",
  projectId: "pae-asistencia",
  storageBucket: "pae-asistencia.firebasestorage.app",
  messagingSenderId: "914785630401",
  appId: "1:914785630401:web:55bdbefcd9791829077c40",
  measurementId: "G-719S3CYSFY"
};
