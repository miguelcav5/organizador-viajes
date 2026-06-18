# organizador-viajes

Organizador de viaje con sincronización en tiempo real entre dispositivos usando Firebase Firestore y acceso por contraseña compartida.

## Activar sincronización en tiempo real

1. Crea un proyecto en Firebase Console.
2. Añade una app Web al proyecto y copia la configuración de Firebase.
3. Activa Firestore Database.
4. Edita [index.html](index.html) y completa los campos de `window.TRIP_FIREBASE_CONFIG`.
5. En [index.html](index.html), deja el mismo valor de `window.TRIP_ID` en todos los dispositivos para compartir el mismo viaje.
6. En [index.html](index.html), define `window.TRIP_SHARED_PASSWORD` con una clave compartida por el grupo.

Ejemplo de configuración:

```html
<script>
	window.TRIP_FIREBASE_CONFIG = {
		apiKey: 'TU_API_KEY',
		authDomain: 'tu-proyecto.firebaseapp.com',
		projectId: 'tu-proyecto',
		storageBucket: 'tu-proyecto.firebasestorage.app',
		messagingSenderId: '1234567890',
		appId: '1:1234567890:web:abcdef123456'
	};

	window.TRIP_ID = 'china-2026';

	window.TRIP_SHARED_PASSWORD = 'cambia-esta-clave';
</script>
```

## Reglas de Firestore para este modo (sin login)

Para que la sincronización funcione sin autenticación, las reglas deben permitir acceso abierto al documento del viaje.

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /trips/{tripId} {
			allow read, write: if true;
		}
	}
}
```

## Comportamiento de acceso

- Si no introduces la contraseña compartida, la app no muestra el contenido.
- Si la contraseña es correcta, se habilita la app y sincroniza en tiempo real.

## Nota de seguridad

- Este modo es sencillo pero débil: la contraseña solo se valida en el navegador.
- Si necesitas seguridad real, usa autenticación de Firebase y reglas cerradas por usuario.