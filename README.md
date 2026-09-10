# ZeroStressHome

App web/PWA para compartir las estancias en una casa de Madrid.

## Qué hace

- Calendario mensual compartido.
- Cada persona tiene su propia cuenta.
- Una persona crea la casa y obtiene un código de invitación.
- La otra entra con ese código.
- Cada día puede tener:
  - una persona,
  - la otra persona,
  - o las dos a la vez.
- Los cambios aparecen en tiempo real gracias a Firebase Firestore.
- Se puede instalar como app en el móvil.
- La interfaz funciona en GitHub Pages y no necesita un servidor propio.

## Estructura

- `index.html` — pantalla de la app.
- `styles.css` — diseño.
- `app.js` — lógica y calendario.
- `firebase-config.js` — configuración de Firebase.
- `firestore.rules` — reglas de seguridad.
- `manifest.webmanifest` — instalación como PWA.
- `sw.js` — caché/offline de la interfaz.
- `icon.svg` — icono.
- `.nojekyll` — publicación directa en GitHub Pages.

## Configuración de Firebase

1. Entra en Firebase Console.
2. Crea un proyecto, por ejemplo `zerostresshome`.
3. Añade una aplicación web.
4. Copia su configuración en `firebase-config.js`.
5. En Authentication → Sign-in method activa **Email/Password**.
6. En Firestore Database crea la base de datos.
7. Publica las reglas de `firestore.rules`.

## Publicar en GitHub Pages

Sube todos los archivos a un repositorio llamado `ZeroStressHome`.

En GitHub:
`Settings → Pages → Deploy from a branch → main → / (root)`.

GitHub Pages publica archivos estáticos directamente. La app se abrirá en una URL tipo:

`https://TU-USUARIO.github.io/ZeroStressHome/`

## Primer uso

1. Marta o tú creáis una cuenta.
2. Esa persona pulsa `Crear ZeroStressHome`.
3. La app muestra un código de 6 caracteres.
4. Se comparte ese código con la otra persona.
5. La otra persona crea su cuenta y pulsa `Unirme a una casa`.
6. A partir de ahí ambas ven el mismo calendario.

## Importante

La interfaz puede funcionar offline una vez cargada, pero las reservas compartidas necesitan conexión para sincronizarse con Firebase. El objetivo de la app es que la información compartida esté en la nube, no guardada únicamente en el navegador.

## Siguiente evolución

Esta base está preparada para añadir posteriormente:
- notas por estancia,
- avisos de entrada/salida,
- colores o perfiles adicionales,
- bloqueo de fechas,
- limpieza,
- historial,
- notificaciones,
- y sincronización más avanzada.


## Reservas por estancia
Las reservas se seleccionan con **Desde** y **Hasta**. Ambos días se consideran incluidos. También se puede elegir el rango directamente tocando primero el día de inicio y después el día final en el calendario.
