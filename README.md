# organizador-viajes

Organizador de viaje con sincronización en tiempo real entre dispositivos usando Firebase Firestore y acceso con Google Sign-In.

## Activar sincronización en tiempo real

1. Crea un proyecto en Firebase Console.
2. Añade una app Web al proyecto y copia la configuración de Firebase.
3. Activa Firestore Database.
4. En Firebase Console, ve a Authentication > Método de acceso y habilita Google.
5. Edita [index.html](index.html) y completa los campos de `window.TRIP_FIREBASE_CONFIG`.
6. En [index.html](index.html), deja el mismo valor de `window.TRIP_ID` en todos los dispositivos para compartir el mismo viaje.
7. En [index.html](index.html), rellena `window.TRIP_ALLOWED_EMAILS` con los correos de tu grupo.

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

	window.TRIP_ALLOWED_EMAILS = [
		'tu-email@gmail.com',
		'amigo1@gmail.com',
		'amigo2@gmail.com'
	];
</script>
```

## Reglas de Firestore para copiar/pegar (recomendadas)

Sustituye los emails por tu grupo y publícalas en la pestaña Reglas de Firestore.

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		function isAllowedEmail() {
			return request.auth != null
				&& request.auth.token.email != null
				&& request.auth.token.email in [
					'tu-email@gmail.com',
					'amigo1@gmail.com',
					'amigo2@gmail.com'
				];
		}

		match /trips/{tripId} {
			allow read, write: if isAllowedEmail();
		}

		match /{document=**} {
			allow read, write: if false;
		}
	}
}
```

## Comportamiento de acceso

- Si no inicias sesión, la app no muestra el contenido.
- Si inicias sesión con un correo no permitido, no tendrás acceso.
- Si el correo está permitido, se habilita la app y sincroniza en tiempo real.

## Nota de seguridad

- No uses reglas abiertas (`allow read, write: if true`) en producción.
- Mantén la lista de emails permitidos actualizada tanto en reglas como en `window.TRIP_ALLOWED_EMAILS`.