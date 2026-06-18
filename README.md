# organizador-viajes

Organizador de viaje con sincronización en tiempo real entre dispositivos usando Firebase Firestore.

## Activar sincronización en tiempo real

1. Crea un proyecto en Firebase Console.
2. Añade una app Web al proyecto y copia la configuración de Firebase.
3. Activa Firestore Database en modo Production (o Test para pruebas rápidas).
4. Edita [index.html](index.html) y completa los campos de `window.TRIP_FIREBASE_CONFIG`.
5. En [index.html](index.html), deja el mismo valor de `window.TRIP_ID` en todos los dispositivos para compartir el mismo viaje.

Ejemplo de configuración:

```html
<script>
	window.TRIP_FIREBASE_CONFIG = {
		apiKey: 'TU_API_KEY',
		authDomain: 'tu-proyecto.firebaseapp.com',
		projectId: 'tu-proyecto',
		storageBucket: 'tu-proyecto.appspot.com',
		messagingSenderId: '1234567890',
		appId: '1:1234567890:web:abcdef123456'
	};

	window.TRIP_ID = 'china-2026';
</script>
```

## Reglas mínimas de Firestore (pruebas)

Usa estas reglas solo para pruebas iniciales:

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

Para producción, añade autenticación y restringe acceso por usuario o por grupo.

## Comportamiento de la app

- Si Firebase está configurado correctamente, los cambios se sincronizan en tiempo real.
- Si Firebase no está configurado o falla, la app sigue funcionando con almacenamiento local.