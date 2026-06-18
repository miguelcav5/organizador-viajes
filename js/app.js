/* =========================================================
   China Trip Organizer — Application Logic
   ========================================================= */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────

const PEOPLE = ['Naxi', 'Michi', 'Rafa', 'Pato', 'Marisol', 'Laura', 'Gabri', 'Sergio', 'Miguel'];

const STORAGE_KEY = 'china-trip-data-v1';

// Threshold (in euros) below which a balance is treated as zero for display purposes
const BALANCE_THRESHOLD = 0.005;

const CATEGORY_ICONS = {
  tour:          '🚌',
  museum:        '🏛️',
  food:          '🍜',
  transport:     '🚆',
  hotel:         '🏨',
  accommodation: '🏨',
  shopping:      '🛍️',
  activities:    '🏛️',
  other:         '📌',
};

const CATEGORY_LABELS = {
  tour:          'Tour',
  museum:        'Museo / Templo',
  food:          'Comida',
  transport:     'Transporte',
  hotel:         'Alojamiento',
  accommodation: 'Alojamiento',
  shopping:      'Compras',
  activities:    'Actividades',
  other:         'Otro',
};

// ─── State ───────────────────────────────────────────────────────────────────

let state = {
  itinerary:  [],   // [{id, date, city, morning, afternoon, evening, notes}]
  flights:    [],   // [{id, flightNumber, airline, origin, destination, date, departure, arrival, arrivalDate, notes}]
  activities: [],   // [{id, name, date, time, duration, location, price, category, participants, description}]
  expenses:   [],   // [{id, description, amount, paidBy, date, category, participants, notes}]
};

let db = null;
let auth = null;
let tripDocRef = null;
let remoteSyncEnabled = false;
let remoteUnsubscribe = null;
let isApplyingRemoteState = false;
let isAuthorizedUser = false;
let initializedForUid = null;

function defaultState() {
  return { itinerary: [], flights: [], activities: [], expenses: [] };
}

function normalizeState(raw) {
  return Object.assign(defaultState(), raw || {});
}

function setAuthGate(title, message) {
  const titleEl = document.getElementById('authGateTitle');
  const messageEl = document.getElementById('authGateMessage');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
}

function setAppVisibility(visible) {
  const tabs = document.getElementById('mainTabs');
  const main = document.getElementById('appMain');
  const gate = document.getElementById('authGate');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');

  if (visible) {
    tabs && tabs.removeAttribute('hidden');
    main && main.removeAttribute('hidden');
    gate && gate.setAttribute('hidden', '');
  } else {
    tabs && tabs.setAttribute('hidden', '');
    main && main.setAttribute('hidden', '');
    gate && gate.removeAttribute('hidden');
  }

  if (exportBtn) exportBtn.disabled = !visible;
  if (importBtn) importBtn.disabled = !visible;
}

function updateSessionUi(user) {
  const pill = document.getElementById('currentUserPill');
  const signOutBtn = document.getElementById('signOutBtn');

  if (user) {
    if (pill) {
      pill.textContent = user.email || 'Usuario compartido';
      pill.removeAttribute('hidden');
    }
    signOutBtn && signOutBtn.removeAttribute('hidden');
    return;
  }

  if (pill) {
    pill.textContent = '';
    pill.setAttribute('hidden', '');
  }
  signOutBtn && signOutBtn.setAttribute('hidden', '');
}

async function signInWithSharedUser() {
  const emailInput = document.getElementById('sharedUserEmailInput');
  const passwordInput = document.getElementById('sharedUserPasswordInput');
  const email = String(emailInput?.value || '').trim();
  const password = String(passwordInput?.value || '');

  if (!auth) {
    setAuthGate('⚠️ Falta configuración', 'Firebase Auth no está disponible. Revisa la configuración del proyecto.');
    setAppVisibility(false);
    return;
  }

  if (!email || !password) {
    showToast('⚠️ Introduce email y contraseña');
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    if (passwordInput) passwordInput.value = '';
  } catch (err) {
    console.error('Firebase Auth sign-in error:', err);
    showToast('❌ No se pudo iniciar sesión');
  }
}

async function signOutCurrentUser() {
  if (!auth) {
    return;
  }

  try {
    await auth.signOut();
    showToast('✅ Sesión cerrada');
  } catch (err) {
    console.error('Firebase Auth sign-out error:', err);
    showToast('⚠️ No se pudo cerrar la sesión');
  }
}

function bindPasswordGate() {
  const btn = document.getElementById('unlockAppBtn');
  const emailInput = document.getElementById('sharedUserEmailInput');
  const passwordInput = document.getElementById('sharedUserPasswordInput');

  if (btn) {
    btn.addEventListener('click', () => {
      signInWithSharedUser();
    });
  }

  [emailInput, passwordInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        signInWithSharedUser();
      }
    });
  });
}

function bindAuthActions() {
  const signOutBtn = document.getElementById('signOutBtn');
  signOutBtn?.addEventListener('click', signOutCurrentUser);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveStateLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Storage write error:', err);
    showToast('⚠️ No se pudo guardar. El almacenamiento local está lleno.');
  }
}

function loadStateLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = normalizeState(parsed);
    }
  } catch (err) {
    console.error('Storage read error:', err);
    showToast('⚠️ Error al cargar los datos guardados.');
  }
}

function saveState() {
  saveStateLocal();

  if (!isAuthorizedUser || !remoteSyncEnabled || !tripDocRef || isApplyingRemoteState) {
    return;
  }

  tripDocRef
    .set(
      {
        state,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch((err) => {
      console.error('Firestore write error:', err);
      showToast('⚠️ No se pudo sincronizar en la nube. Se guardó localmente.');
    });
}

async function initRemoteSync() {
  const config = window.TRIP_FIREBASE_CONFIG;
  const tripId = (window.TRIP_ID || '').trim();

  if (!config || !config.apiKey || !config.projectId || !tripId) {
    return;
  }

  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    console.error('Firebase SDK no está disponible.');
    showToast('⚠️ Firebase no cargó. Usando modo local.');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    auth = firebase.auth();
    db = firebase.firestore();
    tripDocRef = db.collection('trips').doc(tripId);
    remoteSyncEnabled = true;
  } catch (err) {
    console.error('Firebase init error:', err);
    remoteSyncEnabled = false;
    showToast('⚠️ Error de Firebase. Usando modo local.');
  }
}

async function loadState() {
  loadStateLocal();

  if (!isAuthorizedUser || !remoteSyncEnabled || !tripDocRef) {
    return;
  }

  try {
    const snap = await tripDocRef.get();
    if (snap.exists && snap.data() && snap.data().state) {
      state = normalizeState(snap.data().state);
      saveStateLocal();
    } else {
      await tripDocRef.set(
        {
          state,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error('Firestore read error:', err);
    showToast('⚠️ No se pudo leer la nube. Mostrando datos locales.');
  }
}

function subscribeRemoteState() {
  if (!isAuthorizedUser || !remoteSyncEnabled || !tripDocRef) {
    return;
  }

  if (remoteUnsubscribe) {
    remoteUnsubscribe();
  }

  remoteUnsubscribe = tripDocRef.onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      if (!data || !data.state) return;

      const incoming = normalizeState(data.state);
      if (JSON.stringify(incoming) === JSON.stringify(state)) {
        return;
      }

      isApplyingRemoteState = true;
      state = incoming;
      saveStateLocal();
      renderAll();
      isApplyingRemoteState = false;
      showToast('🔄 Datos sincronizados');
    },
    (err) => {
      console.error('Firestore realtime error:', err);
      showToast('⚠️ Sin conexión en tiempo real.');
    }
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatAmount(n) {
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function showToast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.removeAttribute('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.setAttribute('hidden', ''); }, duration);
}

// ─── Modal helpers ───────────────────────────────────────────────────────────

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }
}

// Close modals on overlay click or close button
document.addEventListener('click', (e) => {
  // Close on overlay click
  if (e.target.classList.contains('modal-overlay')) {
    e.target.setAttribute('hidden', '');
    document.body.style.overflow = '';
    return;
  }
  
  // Close on close button (✕)
  if (e.target.classList.contains('modal-close')) {
    const modalId = e.target.getAttribute('data-modal');
    if (modalId) {
      closeModal(modalId);
    }
    return;
  }
  
  // Close on cancel button with data-modal attribute
  if (e.target.dataset.modal && e.target.textContent.includes('Cancelar')) {
    closeModal(e.target.dataset.modal);
    return;
  }
});

// ─── Tab Navigation ──────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── Delete helper ───────────────────────────────────────────────────────────

let _pendingDelete = null;

function confirmDelete(label, onConfirm) {
  _pendingDelete = onConfirm;
  document.getElementById('deleteItemName').textContent = label;
  openModal('deleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  if (_pendingDelete) { _pendingDelete(); _pendingDelete = null; }
  closeModal('deleteModal');
});

// ─── ITINERARY ───────────────────────────────────────────────────────────────

function renderItinerary() {
  const list = document.getElementById('itineraryList');
  const sorted = [...state.itinerary].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🗓️</span>
        <p>No hay días añadidos todavía.</p>
        <p>¡Empieza planificando tu viaje!</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map((day) => `
    <div class="day-card" data-id="${esc(day.id)}">
      <div class="day-card-header">
        <div>
          <div class="day-card-date">${esc(formatDate(day.date))}</div>
          <div class="day-card-city">📍 ${esc(day.city)}</div>
        </div>
        <div class="day-card-actions">
          <button class="card-btn edit-day-btn" data-id="${esc(day.id)}" title="Editar">✏️</button>
          <button class="card-btn danger delete-day-btn" data-id="${esc(day.id)}" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="day-card-body">
        ${day.morning ? `<div class="day-time-block">
          <div class="day-time-label">🌅 Mañana</div>
          <div class="day-time-content">${esc(day.morning)}</div>
        </div>` : ''}
        ${day.afternoon ? `<div class="day-time-block">
          <div class="day-time-label">☀️ Tarde</div>
          <div class="day-time-content">${esc(day.afternoon)}</div>
        </div>` : ''}
        ${day.evening ? `<div class="day-time-block">
          <div class="day-time-label">🌙 Noche</div>
          <div class="day-time-content">${esc(day.evening)}</div>
        </div>` : ''}
        ${day.notes ? `<div class="day-notes">📝 ${esc(day.notes)}</div>` : ''}
      </div>
    </div>`).join('');

  // Wire up buttons
  list.querySelectorAll('.edit-day-btn').forEach((btn) => {
    btn.addEventListener('click', () => openDayModal(btn.dataset.id));
  });
  list.querySelectorAll('.delete-day-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = state.itinerary.find((d) => d.id === btn.dataset.id);
      confirmDelete(formatDate(day?.date) + ' – ' + (day?.city || ''), () => {
        state.itinerary = state.itinerary.filter((d) => d.id !== btn.dataset.id);
        saveState();
        renderItinerary();
        showToast('✅ Día eliminado');
      });
    });
  });
}

function openDayModal(id) {
  const form = document.getElementById('dayForm');
  form.reset();
  document.getElementById('dayId').value = '';
  document.getElementById('dayModalTitle').textContent = 'Añadir Día';

  if (id) {
    const day = state.itinerary.find((d) => d.id === id);
    if (!day) return;
    document.getElementById('dayModalTitle').textContent = 'Editar Día';
    document.getElementById('dayId').value = day.id;
    document.getElementById('dayDate').value = day.date;
    document.getElementById('dayCity').value = day.city;
    document.getElementById('dayMorning').value = day.morning || '';
    document.getElementById('dayAfternoon').value = day.afternoon || '';
    document.getElementById('dayEvening').value = day.evening || '';
    document.getElementById('dayNotes').value = day.notes || '';
  } else {
    document.getElementById('dayDate').value = todayStr();
  }

  openModal('dayModal');
}

document.getElementById('addDayBtn').addEventListener('click', () => openDayModal(null));

document.getElementById('dayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('dayId').value || uid();
  const existing = state.itinerary.findIndex((d) => d.id === id);
  const entry = {
    id,
    date:      document.getElementById('dayDate').value,
    city:      document.getElementById('dayCity').value.trim(),
    morning:   document.getElementById('dayMorning').value.trim(),
    afternoon: document.getElementById('dayAfternoon').value.trim(),
    evening:   document.getElementById('dayEvening').value.trim(),
    notes:     document.getElementById('dayNotes').value.trim(),
  };

  if (existing >= 0) { state.itinerary[existing] = entry; }
  else { state.itinerary.push(entry); }

  saveState();
  renderItinerary();
  closeModal('dayModal');
  showToast(existing >= 0 ? '✅ Día actualizado' : '✅ Día añadido');
});

// ─── FLIGHTS ─────────────────────────────────────────────────────────────────

function renderFlights() {
  const list = document.getElementById('flightsList');
  const sorted = [...state.flights].sort((a, b) => {
    const da = (a.date || '') + (a.departure || '');
    const db = (b.date || '') + (b.departure || '');
    return da.localeCompare(db);
  });

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🚆</span>
        <p>No hay transportes registrados todavía.</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map((fl) => `
    <div class="flight-card">
      <div>
        <div class="flight-route">
          <div class="flight-airport">
            <div class="code">${esc(fl.origin)}</div>
            <div class="time">${esc(fl.departure || '—')}</div>
          </div>
          <div class="flight-arrow">
            <div class="flight-arrow-line"></div>
            <div class="flight-arrow-plane">🚆</div>
            <div class="flight-number-badge">${esc(fl.flightNumber || '')}</div>
          </div>
          <div class="flight-airport">
            <div class="code">${esc(fl.destination)}</div>
            <div class="time">${esc(fl.arrival || '—')}</div>
            ${fl.arrivalDate && fl.arrivalDate !== fl.date ? `<div class="city" style="color:#e74c3c;font-size:.7rem">+1 día</div>` : ''}
          </div>
        </div>
        <div class="flight-meta">
          <span>📅 ${esc(formatDate(fl.date))}</span>
          ${fl.airline ? `<span>🏢 ${esc(fl.airline)}</span>` : ''}
          ${fl.flightNumber ? `<span>🎫 ${esc(fl.flightNumber)}</span>` : ''}
        </div>
        ${fl.notes ? `<div class="flight-notes">📝 ${esc(fl.notes)}</div>` : ''}
      </div>
      <div class="flight-actions">
        <button class="card-btn edit-flight-btn" data-id="${esc(fl.id)}" title="Editar">✏️</button>
        <button class="card-btn danger delete-flight-btn" data-id="${esc(fl.id)}" title="Eliminar">🗑️</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.edit-flight-btn').forEach((btn) => {
    btn.addEventListener('click', () => openFlightModal(btn.dataset.id));
  });
  list.querySelectorAll('.delete-flight-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fl = state.flights.find((f) => f.id === btn.dataset.id);
      confirmDelete(`Transporte ${fl?.flightNumber || ''} ${fl?.origin || ''}→${fl?.destination || ''}`, () => {
        state.flights = state.flights.filter((f) => f.id !== btn.dataset.id);
        saveState();
        renderFlights();
        showToast('✅ Transporte eliminado');
      });
    });
  });
}

function openFlightModal(id) {
  const form = document.getElementById('flightForm');
  form.reset();
  document.getElementById('flightId').value = '';
  document.getElementById('flightModalTitle').textContent = 'Añadir Transporte';

  if (id) {
    const fl = state.flights.find((f) => f.id === id);
    if (!fl) return;
    document.getElementById('flightModalTitle').textContent = 'Editar Transporte';
    document.getElementById('flightId').value = fl.id;
    document.getElementById('flightNumber').value = fl.flightNumber || '';
    document.getElementById('flightAirline').value = fl.airline || '';
    document.getElementById('flightOrigin').value = fl.origin || '';
    document.getElementById('flightDestination').value = fl.destination || '';
    document.getElementById('flightDate').value = fl.date || '';
    document.getElementById('flightDeparture').value = fl.departure || '';
    document.getElementById('flightArrival').value = fl.arrival || '';
    document.getElementById('flightArrivalDate').value = fl.arrivalDate || '';
    document.getElementById('flightNotes').value = fl.notes || '';
  } else {
    document.getElementById('flightDate').value = todayStr();
  }

  openModal('flightModal');
}

document.getElementById('addFlightBtn').addEventListener('click', () => openFlightModal(null));

document.getElementById('flightForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('flightId').value || uid();
  const existing = state.flights.findIndex((f) => f.id === id);
  const entry = {
    id,
    flightNumber: document.getElementById('flightNumber').value.trim(),
    airline:      document.getElementById('flightAirline').value.trim(),
    origin:       document.getElementById('flightOrigin').value.trim(),
    destination:  document.getElementById('flightDestination').value.trim(),
    date:         document.getElementById('flightDate').value,
    departure:    document.getElementById('flightDeparture').value,
    arrival:      document.getElementById('flightArrival').value,
    arrivalDate:  document.getElementById('flightArrivalDate').value,
    notes:        document.getElementById('flightNotes').value.trim(),
  };

  if (existing >= 0) { state.flights[existing] = entry; }
  else { state.flights.push(entry); }

  saveState();
  renderFlights();
  closeModal('flightModal');
  showToast(existing >= 0 ? '✅ Transporte actualizado' : '✅ Transporte añadido');
});

// ─── ACTIVITIES ──────────────────────────────────────────────────────────────

function buildParticipantsGrid(containerId, selected) {
  const container = document.getElementById(containerId);
  container.innerHTML = PEOPLE.map((p) => {
    const checked = selected && selected.includes(p) ? 'selected' : '';
    return `<label class="participant-chip ${checked}" data-person="${esc(p)}">
      <input type="checkbox" name="participant" value="${esc(p)}" ${checked ? 'checked' : ''}>
      ${esc(p)}
    </label>`;
  }).join('');

  // Use a single delegated listener on the container to avoid duplicate handlers
  container.onclick = (e) => {
    const chip = e.target.closest('.participant-chip');
    if (!chip) return;
    const cb = chip.querySelector('input[type="checkbox"]');
    cb.checked = !cb.checked;
    chip.classList.toggle('selected', cb.checked);
    if (containerId === 'expenseParticipants') updateSplitPreview();
  };
}

function getCheckedParticipants(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
    .map((cb) => cb.value);
}

function renderActivities() {
  const list = document.getElementById('activitiesList');
  const sorted = [...state.activities].sort((a, b) => {
    const da = (a.date || '9999') + (a.time || '');
    const db = (b.date || '9999') + (b.time || '');
    return da.localeCompare(db);
  });

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🏛️</span>
        <p>No hay actividades registradas todavía.</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map((act) => {
    const icon = CATEGORY_ICONS[act.category] || '📌';
    const label = CATEGORY_LABELS[act.category] || 'Otro';
    const parts = act.participants && act.participants.length > 0
      ? act.participants.map((p) => `<span class="person-tag">${esc(p)}</span>`).join(' ')
      : PEOPLE.map((p) => `<span class="person-tag">${esc(p)}</span>`).join(' ');

    return `
    <div class="activity-card">
      <div class="activity-card-header">
        <div>
          <div class="activity-name">${icon} ${esc(act.name)}</div>
        </div>
        <div style="display:flex;gap:.4rem;align-items:flex-start">
          <span class="activity-badge">${esc(label)}</span>
          <button class="card-btn edit-activity-btn" data-id="${esc(act.id)}" title="Editar">✏️</button>
          <button class="card-btn danger delete-activity-btn" data-id="${esc(act.id)}" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="activity-meta">
        ${act.date ? `<span>📅 ${esc(formatDate(act.date))}</span>` : ''}
        ${act.time ? `<span>🕐 ${esc(act.time)}</span>` : ''}
        ${act.duration ? `<span>⏱️ ${esc(act.duration)}</span>` : ''}
        ${act.location ? `<span>📍 ${esc(act.location)}</span>` : ''}
        ${act.price ? `<span>💶 ${esc(formatAmount(act.price))} / persona</span>` : ''}
      </div>
      ${act.description ? `<div class="activity-description">${esc(act.description)}</div>` : ''}
      <div class="activity-participants-row">👥 ${parts}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.edit-activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => openActivityModal(btn.dataset.id));
  });
  list.querySelectorAll('.delete-activity-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = state.activities.find((a) => a.id === btn.dataset.id);
      confirmDelete(act?.name || '', () => {
        state.activities = state.activities.filter((a) => a.id !== btn.dataset.id);
        saveState();
        renderActivities();
        showToast('✅ Actividad eliminada');
      });
    });
  });
}

function openActivityModal(id) {
  const form = document.getElementById('activityForm');
  form.reset();
  document.getElementById('activityId').value = '';
  document.getElementById('activityModalTitle').textContent = 'Añadir Actividad';

  if (id) {
    const act = state.activities.find((a) => a.id === id);
    if (!act) return;
    document.getElementById('activityModalTitle').textContent = 'Editar Actividad';
    document.getElementById('activityId').value = act.id;
    document.getElementById('activityName').value = act.name || '';
    document.getElementById('activityDate').value = act.date || '';
    document.getElementById('activityTime').value = act.time || '';
    document.getElementById('activityDuration').value = act.duration || '';
    document.getElementById('activityLocation').value = act.location || '';
    document.getElementById('activityPrice').value = act.price || '';
    document.getElementById('activityCategory').value = act.category || 'tour';
    document.getElementById('activityDescription').value = act.description || '';
    buildParticipantsGrid('activityParticipants', act.participants || PEOPLE);
  } else {
    buildParticipantsGrid('activityParticipants', PEOPLE);
  }

  openModal('activityModal');
}

document.getElementById('addActivityBtn').addEventListener('click', () => openActivityModal(null));

document.getElementById('activityForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('activityId').value || uid();
  const existing = state.activities.findIndex((a) => a.id === id);
  const entry = {
    id,
    name:         document.getElementById('activityName').value.trim(),
    date:         document.getElementById('activityDate').value,
    time:         document.getElementById('activityTime').value,
    duration:     document.getElementById('activityDuration').value.trim(),
    location:     document.getElementById('activityLocation').value.trim(),
    price:        parseFloat(document.getElementById('activityPrice').value) || 0,
    category:     document.getElementById('activityCategory').value,
    participants: getCheckedParticipants('activityParticipants'),
    description:  document.getElementById('activityDescription').value.trim(),
  };

  if (existing >= 0) { state.activities[existing] = entry; }
  else { state.activities.push(entry); }

  saveState();
  renderActivities();
  closeModal('activityModal');
  showToast(existing >= 0 ? '✅ Actividad actualizada' : '✅ Actividad añadida');
});

// ─── EXPENSES ────────────────────────────────────────────────────────────────

function populatePaidBySelect() {
  const sel = document.getElementById('expensePaidBy');
  sel.innerHTML = '<option value="">Selecciona...</option>' +
    PEOPLE.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
}

function populateFilterSelect() {
  const sel = document.getElementById('expenseFilterPerson');
  sel.innerHTML = '<option value="">Todos</option>' +
    PEOPLE.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
}

function updateSplitPreview() {
  const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;
  const participants = getCheckedParticipants('expenseParticipants');
  const preview = document.getElementById('splitPreview');
  if (participants.length === 0 || amount === 0) {
    preview.textContent = '';
    return;
  }
  const share = amount / participants.length;
  preview.textContent = `💡 ${participants.length} persona${participants.length > 1 ? 's' : ''} · ${formatAmount(share)} / persona`;
}

document.getElementById('expenseAmount').addEventListener('input', updateSplitPreview);

document.getElementById('selectAllParticipants').addEventListener('click', () => {
  document.querySelectorAll('#expenseParticipants .participant-chip').forEach((chip) => {
    chip.classList.add('selected');
    chip.querySelector('input').checked = true;
  });
  updateSplitPreview();
});

document.getElementById('deselectAllParticipants').addEventListener('click', () => {
  document.querySelectorAll('#expenseParticipants .participant-chip').forEach((chip) => {
    chip.classList.remove('selected');
    chip.querySelector('input').checked = false;
  });
  updateSplitPreview();
});

function computeExpenseSummary() {
  const summary = {};
  PEOPLE.forEach((p) => { summary[p] = { paid: 0, owed: 0 }; });

  state.expenses.forEach((exp) => {
    const amount = parseFloat(exp.amount) || 0;
    const participants = exp.participants && exp.participants.length > 0 ? exp.participants : PEOPLE;
    const share = amount / participants.length;

    if (exp.paidBy && summary[exp.paidBy] !== undefined) {
      summary[exp.paidBy].paid += amount;
    }

    participants.forEach((p) => {
      if (summary[p] !== undefined) {
        summary[p].owed += share;
      }
    });
  });

  return summary;
}

function computeSettlements(summary) {
  const creditors = [];
  const debtors = [];

  PEOPLE.forEach((person) => {
    const row = summary[person] || { paid: 0, owed: 0 };
    const balanceCents = Math.round((row.paid - row.owed) * 100);

    if (balanceCents > 0) {
      creditors.push({ person, amountCents: balanceCents });
    } else if (balanceCents < 0) {
      debtors.push({ person, amountCents: -balanceCents });
    }
  });

  creditors.sort((a, b) => b.amountCents - a.amountCents);
  debtors.sort((a, b) => b.amountCents - a.amountCents);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amountCents = Math.min(debtor.amountCents, creditor.amountCents);

    if (amountCents > 0) {
      settlements.push({
        from: debtor.person,
        to: creditor.person,
        amount: amountCents / 100,
      });
    }

    debtor.amountCents -= amountCents;
    creditor.amountCents -= amountCents;

    if (debtor.amountCents === 0) i += 1;
    if (creditor.amountCents === 0) j += 1;
  }

  return settlements;
}

function renderSettlements(summary) {
  const list = document.getElementById('settlementsList');
  if (!list) return;

  if (state.expenses.length === 0) {
    list.innerHTML = '<div class="settlement-empty">Añade gastos para ver sugerencias de liquidación.</div>';
    return;
  }

  const settlements = computeSettlements(summary);
  if (settlements.length === 0) {
    list.innerHTML = '<div class="settlement-empty">Todo está equilibrado. No hace falta realizar transferencias.</div>';
    return;
  }

  list.innerHTML = settlements.map((s) => `
    <div class="settlement-item">
      <div class="settlement-flow">
        <span class="settlement-from">${esc(s.from)}</span>
        <span class="settlement-arrow">→</span>
        <span class="settlement-to">${esc(s.to)}</span>
      </div>
      <div class="settlement-amount">${esc(formatAmount(s.amount))}</div>
    </div>
  `).join('');
}

function renderExpenseSummary() {
  const summary = computeExpenseSummary();
  const tbody = document.getElementById('summaryTableBody');
  let totalPaid = 0;
  let totalOwed = 0;

  tbody.innerHTML = PEOPLE.map((p) => {
    const { paid, owed } = summary[p];
    const balance = paid - owed;
    totalPaid += paid;
    totalOwed += owed;

    const balClass = balance > BALANCE_THRESHOLD ? 'balance-positive' : balance < -BALANCE_THRESHOLD ? 'balance-negative' : 'balance-zero';
    const balSign  = balance > BALANCE_THRESHOLD ? '+' : '';

    return `<tr>
      <td><strong>${esc(p)}</strong></td>
      <td>${esc(formatAmount(paid))}</td>
      <td>${esc(formatAmount(owed))}</td>
      <td class="${balClass}">${balSign}${esc(formatAmount(balance))}</td>
    </tr>`;
  }).join('');

  document.getElementById('summaryTotalPaid').textContent = formatAmount(totalPaid);
  document.getElementById('summaryTotalOwed').textContent = formatAmount(totalOwed);
  renderSettlements(summary);
}

function renderExpenses() {
  const filterPerson = document.getElementById('expenseFilterPerson').value;
  const list = document.getElementById('expensesList');

  let filtered = [...state.expenses].sort((a, b) => {
    const da = a.date || '0000';
    const db = b.date || '0000';
    return db.localeCompare(da); // newest first
  });

  if (filterPerson) {
    filtered = filtered.filter((exp) => {
      const parts = exp.participants && exp.participants.length > 0 ? exp.participants : PEOPLE;
      return exp.paidBy === filterPerson || parts.includes(filterPerson);
    });
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💰</span>
        <p>No hay gastos registrados todavía.</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((exp) => {
    const amount = parseFloat(exp.amount) || 0;
    const participants = exp.participants && exp.participants.length > 0 ? exp.participants : PEOPLE;
    const perPerson = amount / participants.length;
    const icon = CATEGORY_ICONS[exp.category] || '📌';
    const participantTags = participants.map((p) => `<span class="person-tag">${esc(p)}</span>`).join(' ');

    return `
    <div class="expense-card">
      <div>
        <div class="expense-header">
          <div class="expense-category-icon">${icon}</div>
          <div>
            <div class="expense-description">${esc(exp.description)}</div>
            <div class="expense-meta">
              ${exp.date ? `<span>📅 ${esc(formatDate(exp.date))}</span>` : ''}
              <span>💳 Pagó: <strong>${esc(exp.paidBy)}</strong></span>
              <span>👥 ${participants.length} persona${participants.length > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <div class="expense-participants">Dividido entre: ${participantTags}</div>
        ${exp.notes ? `<div class="expense-notes">${esc(exp.notes)}</div>` : ''}
      </div>
      <div>
        <div class="expense-amount-block">
          <div class="expense-amount">${esc(formatAmount(amount))}</div>
          <div class="expense-per-person">${esc(formatAmount(perPerson))} / persona</div>
        </div>
        <div class="expense-actions">
          <button class="card-btn edit-expense-btn" data-id="${esc(exp.id)}" title="Editar">✏️</button>
          <button class="card-btn danger delete-expense-btn" data-id="${esc(exp.id)}" title="Eliminar">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.edit-expense-btn').forEach((btn) => {
    btn.addEventListener('click', () => openExpenseModal(btn.dataset.id));
  });
  list.querySelectorAll('.delete-expense-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exp = state.expenses.find((x) => x.id === btn.dataset.id);
      confirmDelete(exp?.description || '', () => {
        state.expenses = state.expenses.filter((x) => x.id !== btn.dataset.id);
        saveState();
        renderExpenses();
        renderExpenseSummary();
        showToast('✅ Gasto eliminado');
      });
    });
  });
}

function openExpenseModal(id) {
  const form = document.getElementById('expenseForm');
  form.reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expenseModalTitle').textContent = 'Añadir Gasto';
  document.getElementById('splitPreview').textContent = '';

  if (id) {
    const exp = state.expenses.find((x) => x.id === id);
    if (!exp) return;
    document.getElementById('expenseModalTitle').textContent = 'Editar Gasto';
    document.getElementById('expenseId').value = exp.id;
    document.getElementById('expenseDescription').value = exp.description || '';
    document.getElementById('expenseAmount').value = exp.amount || '';
    document.getElementById('expensePaidBy').value = exp.paidBy || '';
    document.getElementById('expenseDate').value = exp.date || '';
    document.getElementById('expenseCategory').value = exp.category || 'food';
    document.getElementById('expenseNotes').value = exp.notes || '';
    buildParticipantsGrid('expenseParticipants', exp.participants || PEOPLE);
    updateSplitPreview();
  } else {
    document.getElementById('expenseDate').value = todayStr();
    buildParticipantsGrid('expenseParticipants', PEOPLE);
  }

  openModal('expenseModal');
}

document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal(null));

document.getElementById('expenseFilterPerson').addEventListener('change', renderExpenses);

document.getElementById('expenseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const participants = getCheckedParticipants('expenseParticipants');
  if (participants.length === 0) {
    showToast('⚠️ Selecciona al menos una persona para dividir el gasto.');
    return;
  }

  const id = document.getElementById('expenseId').value || uid();
  const existing = state.expenses.findIndex((x) => x.id === id);
  const entry = {
    id,
    description:  document.getElementById('expenseDescription').value.trim(),
    amount:       parseFloat(document.getElementById('expenseAmount').value) || 0,
    paidBy:       document.getElementById('expensePaidBy').value,
    date:         document.getElementById('expenseDate').value,
    category:     document.getElementById('expenseCategory').value,
    participants,
    notes:        document.getElementById('expenseNotes').value.trim(),
  };

  if (existing >= 0) { state.expenses[existing] = entry; }
  else { state.expenses.push(entry); }

  saveState();
  renderExpenses();
  renderExpenseSummary();
  closeModal('expenseModal');
  showToast(existing >= 0 ? '✅ Gasto actualizado' : '✅ Gasto añadido');
});

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `viaje-china-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 Datos exportados correctamente');
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid format');
      state = normalizeState(parsed);
      saveState();
      renderAll();
      showToast('📥 Datos importados correctamente');
    } catch (err) {
      console.error('Import error:', err);
      showToast('❌ Error al importar el archivo. Asegúrate de que es un JSON válido.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── RENDER ALL ───────────────────────────────────────────────────────────────

function renderAll() {
  renderItinerary();
  renderFlights();
  renderActivities();
  renderExpenses();
  renderExpenseSummary();
}

// ─── INIT ────────────────────────────────────────────────────────────────────

async function bootstrapAuthorizedSession() {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    return;
  }

  if (initializedForUid === currentUser.uid) {
    return;
  }

  if (remoteUnsubscribe) {
    remoteUnsubscribe();
    remoteUnsubscribe = null;
  }

  initializedForUid = currentUser.uid;
  await loadState();
  renderAll();

  if (remoteSyncEnabled) {
    subscribeRemoteState();
    showToast('☁️ Sincronización en tiempo real activada');
  }
}

function resetAuthorizedSession() {
  isAuthorizedUser = false;
  initializedForUid = null;

  if (remoteUnsubscribe) {
    remoteUnsubscribe();
    remoteUnsubscribe = null;
  }

  setAppVisibility(false);
  updateSessionUi(null);
}

function bindAuthStateListener() {
  if (!auth) {
    return;
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      resetAuthorizedSession();
      setAuthGate('🔐 Acceso privado', 'Inicia sesión con el usuario compartido para acceder al viaje.');
      return;
    }

    isAuthorizedUser = true;
    setAppVisibility(true);
    updateSessionUi(user);
    setAuthGate('✅ Acceso concedido', `Sesión iniciada como ${user.email || 'usuario compartido'}.`);
    await bootstrapAuthorizedSession();
  });
}

async function init() {
  populatePaidBySelect();
  populateFilterSelect();
  bindPasswordGate();
  bindAuthActions();

  await initRemoteSync();

  if (!auth) {
    setAuthGate('⚠️ Falta configuración', 'Activa Email/Contraseña en Firebase Authentication.');
    setAppVisibility(false);
    return;
  }

  bindAuthStateListener();
  setAuthGate('🔐 Acceso privado', 'Inicia sesión con el usuario compartido para acceder al viaje.');
  setAppVisibility(false);
}

init();
