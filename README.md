# Organizador de Viajes

Aplicación web ligera para planificar viajes en grupo con cuatro módulos clave:

- Itinerario por días.
- Transporte (vuelos, trenes u otros desplazamientos).
- Actividades y tours.
- Control de gastos con reparto y liquidación optimizada.

La app funciona en navegador y sincroniza datos en tiempo real entre dispositivos usando Firebase Authentication + Firestore.

## Tabla de contenidos

1. [Características](#características)
2. [Tecnologías](#tecnologías)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Modelo de datos](#modelo-de-datos)
5. [Requisitos previos](#requisitos-previos)
6. [Puesta en marcha rápida](#puesta-en-marcha-rápida)
7. [Configuración de Firebase](#configuración-de-firebase)
8. [Autenticación y sincronización](#autenticación-y-sincronización)
9. [Uso funcional](#uso-funcional)
10. [Importación y exportación](#importación-y-exportación)
11. [Persistencia local y nube](#persistencia-local-y-nube)
12. [Seguridad](#seguridad)
13. [Solución de problemas](#solución-de-problemas)
14. [Mejoras recomendadas](#mejoras-recomendadas)

## Características

- Gestión completa del itinerario diario (mañana, tarde, noche, notas).
- Gestión de transporte con origen, destino, horarios, fecha y notas.
- Catálogo de actividades por categoría, precio por persona y participantes.
- Registro de gastos con:
	- Persona que paga.
	- Participantes del gasto.
	- Cálculo del coste por persona.
	- Resumen de balances por viajero.
	- Propuesta automática de transferencias mínimas para saldar deudas.
- Login con usuario compartido en Firebase Authentication.
- Sincronización en tiempo real mediante snapshot listener de Firestore.
- Copia de seguridad manual con exportación/importación JSON.
- Fallback local usando localStorage.

## Tecnologías

- HTML5.
- CSS3.
- JavaScript Vanilla (sin framework).
- Firebase JS SDK (compat):
	- firebase-app-compat.
	- firebase-auth-compat.
	- firebase-firestore-compat.

## Estructura del proyecto

```txt
organizador-viajes/
├── index.html
├── README.md
├── css/
│   └── style.css
└── js/
		└── app.js
```

## Modelo de datos

Estado global de la aplicación:

```js
{
	itinerary:  [], // [{id, date, city, morning, afternoon, evening, notes}]
	flights:    [], // [{id, flightNumber, airline, origin, destination, date, departure, arrival, arrivalDate, notes}]
	activities: [], // [{id, name, date, time, duration, location, price, category, participants, description}]
	expenses:   []  // [{id, description, amount, paidBy, date, category, participants, notes}]
}
```

Documento remoto en Firestore:

```js
trips/{TRIP_ID} => {
	state: { ...estado completo... },
	updatedAt: serverTimestamp()
}
```

## Requisitos previos

- Navegador moderno (Chrome, Edge, Firefox, Safari).
- Proyecto Firebase activo.
- Authentication con Email/Password habilitado.
- Firestore Database habilitado.

## Puesta en marcha rápida

Al ser una app estática, puedes abrirla directamente o servirla en local.

1. Clona el repositorio.
2. Abre la carpeta del proyecto.
3. Configura Firebase en index.html.
4. Ejecuta con un servidor estático local o abre index.html en el navegador.

Ejemplo con servidor local (si tienes Python instalado):

```bash
python3 -m http.server 5500
```

Luego abre:

```txt
http://localhost:5500
```

## Configuración de Firebase

En index.html debes definir:

- window.TRIP_FIREBASE_CONFIG
- window.TRIP_ID

Ejemplo:

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

	// Debe ser el mismo en todos los dispositivos para compartir datos
	window.TRIP_ID = 'china-2026';
</script>
```

### Reglas de Firestore recomendadas

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

## Autenticación y sincronización

Flujo de acceso:

1. El usuario introduce email y contraseña en la pantalla de acceso.
2. Firebase Authentication valida la sesión.
3. Se carga estado local (localStorage).
4. Si hay sesión válida y Firebase activo:
	 - Se lee estado remoto desde trips/{TRIP_ID}.
	 - Se inicia escucha en tiempo real con onSnapshot.
5. Cada cambio se guarda localmente y también en Firestore.

Comportamiento offline:

- Si no hay conectividad o falla Firestore, la app sigue funcionando en local.
- Al recuperar conexión/sesión, vuelve la sincronización en tiempo real.

## Uso funcional

### 1) Itinerario

- Crear y editar días del viaje.
- Definir fecha, ciudad, plan por franjas y notas.

### 2) Transporte

- Registrar trayectos.
- Guardar horarios y fecha de llegada distinta cuando aplique.

### 3) Actividades

- Añadir actividades con categoría, duración, precio por persona y asistentes.

### 4) Gastos

- Registrar gasto total, quién pagó y entre quién se divide.
- Ver resumen de pagado vs. parte correspondiente por persona.
- Ver propuesta de liquidación optimizada entre deudores y acreedores.

## Importación y exportación

- Exportar: descarga un JSON con todo el estado actual.
- Importar: reemplaza el estado actual con el contenido del JSON seleccionado.

Recomendación:

- Haz exportaciones periódicas como respaldo antes de importaciones masivas.

## Persistencia local y nube

- Clave local: china-trip-data-v1 en localStorage.
- Estado remoto: documento único por viaje en trips/{TRIP_ID}.

Prioridad de carga al iniciar sesión:

1. Se carga primero local para respuesta inmediata.
2. Si existe estado remoto, se impone estado remoto y se actualiza local.

## Seguridad

- La contraseña no se almacena en el código de la app.
- El acceso real depende de Firebase Authentication.
- Firestore debe estar protegido con reglas que requieran request.auth.

Nota importante:

- La configuración web de Firebase (apiKey, authDomain, etc.) no sustituye la seguridad de reglas; la protección efectiva está en Authentication + Firestore Rules.

## Solución de problemas

### No aparece la app tras login

- Verifica que Email/Password esté habilitado en Firebase Authentication.
- Revisa credenciales del usuario compartido.

### No sincroniza entre dispositivos

- Confirma que todos usan el mismo window.TRIP_ID.
- Revisa reglas de Firestore y permisos de lectura/escritura.

### Error al importar JSON

- Verifica que el archivo sea JSON válido.
- Comprueba que contenga un objeto con llaves itinerary, flights, activities y expenses.

### Solo funciona en un dispositivo

- Comprueba que ambos dispositivos usan el mismo proyecto Firebase y el mismo TRIP_ID.

## Mejoras recomendadas

- Mover configuración de Firebase a un archivo de configuración externo por entorno.
- Añadir validaciones avanzadas de formularios (fechas, importes, consistencia de horas).
- Incorporar tests unitarios para cálculos de balances y liquidaciones.
- Implementar roles por usuario (solo lectura, edición, admin).
- Agregar soporte multi-viaje con selector de viajes.

---

Si quieres, también puedo dejar una versión del README orientada a despliegue en GitHub Pages con checklist operativo para vuestro grupo (quién crea usuario, cómo rotar contraseña, política de backups, etc.).