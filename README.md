# organizador-viajes

Organizador de viaje con sincronización en tiempo real entre dispositivos usando Firebase Firestore y acceso con un único usuario compartido de Firebase Authentication.

## Configuración recomendada

1. Crea un proyecto en Firebase Console.
2. Añade una app Web al proyecto y copia la configuración de Firebase.
3. Activa Authentication y habilita el proveedor Email/Password.
4. Crea un único usuario compartido en Authentication con el email y la contraseña que vais a usar entre amigos.
5. Activa Firestore Database.
6. Edita [index.html](index.html) y completa `window.TRIP_FIREBASE_CONFIG`.
7. En [index.html](index.html), deja el mismo valor de `window.TRIP_ID` en todos los dispositivos para compartir el mismo viaje.

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
</script>
```

## Reglas de Firestore

Usa reglas cerradas para exigir que el usuario esté autenticado.

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /trips/{tripId} {
			allow read, write: if request.auth != null;
		}
	}
}
```

## Cómo funciona el acceso

- La app muestra una pantalla de login con email y contraseña.
- Solo después de autenticarse con Firebase se carga el viaje y se activa la sincronización en tiempo real.
- La sesión queda gestionada por Firebase y puede cerrarse desde la propia app.

## Ventaja de este enfoque

- La contraseña ya no está publicada en el HTML o en el JavaScript.
- GitHub Pages puede seguir alojando la app sin exponer el secreto.
- Firestore queda protegido por reglas de autenticación reales, no por una validación local del navegador.