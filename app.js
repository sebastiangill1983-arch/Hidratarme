// ---------- Estado ----------
const STORAGE_KEY = "hidratapp_state";
const RING_CIRCUMFERENCE = 552.9; // 2 * PI * 88
const ML_PER_KG = 35; // fórmula usada para sugerir la meta diaria a partir del peso

// URL del backend de notificaciones push (Render).
const BACKEND_URL = "https://hidratapp-backend.onrender.com";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Construye el JSON de la suscripción a mano: en algunos navegadores (Safari/iOS)
// el JSON.stringify automático de una PushSubscription no serializa bien las claves.
function subscriptionToJSON(subscription) {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: arrayBufferToBase64Url(subscription.getKey("p256dh")),
      auth: arrayBufferToBase64Url(subscription.getKey("auth")),
    },
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function suggestedGoalMl(weightKg) {
  return Math.round(weightKg * ML_PER_KG);
}

let state = loadState();

// Si cambió el día, reiniciamos el consumo pero mantenemos la config
if (state && state.lastDay !== todayKey()) {
  state.currentMl = 0;
  state.lastDay = todayKey();
  saveState(state);
}

// ---------- Elementos ----------
const onboardingScreen = document.getElementById("onboarding");
const mainScreen = document.getElementById("main");

const nameInput = document.getElementById("nameInput");
const weightInput = document.getElementById("weightInput");
const goalInput = document.getElementById("goalInput");
const startHourInput = document.getElementById("startHour");
const endHourInput = document.getElementById("endHour");
const intervalInput = document.getElementById("intervalInput");
const startBtn = document.getElementById("startBtn");

const userNameEl = document.getElementById("userName");
const currentMlEl = document.getElementById("currentMl");
const goalMlEl = document.getElementById("goalMl");
const ringProgress = document.getElementById("ringProgress");
const statusMsg = document.getElementById("statusMsg");
const footStart = document.getElementById("foot-start");
const footEnd = document.getElementById("foot-end");
const footInterval = document.getElementById("foot-interval");

const reminderToggleBtn = document.getElementById("reminderToggleBtn");
const reminderStatusLabel = document.getElementById("reminderStatusLabel");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const resetDayBtn = document.getElementById("resetDayBtn");

const editName = document.getElementById("editName");
const editWeight = document.getElementById("editWeight");
const editGoal = document.getElementById("editGoal");
const editStart = document.getElementById("editStart");
const editEnd = document.getElementById("editEnd");
const editInterval = document.getElementById("editInterval");

let reminderTimer = null;

// Mientras el usuario no haya tocado la meta a mano, la recalculamos sola
// cada vez que cambia el peso. Si el usuario edita goalInput directamente,
// dejamos de tocarla (para no pisar un valor indicado por su médico, por ej.).
let goalTouchedManually = false;

goalInput.addEventListener("input", () => {
  goalTouchedManually = true;
});

weightInput.addEventListener("input", () => {
  const weight = parseFloat(weightInput.value);
  if (weight > 0 && !goalTouchedManually) {
    goalInput.value = suggestedGoalMl(weight);
  }
});

let editGoalTouchedManually = false;

editGoal.addEventListener("input", () => {
  editGoalTouchedManually = true;
});

editWeight.addEventListener("input", () => {
  const weight = parseFloat(editWeight.value);
  if (weight > 0 && !editGoalTouchedManually) {
    editGoal.value = suggestedGoalMl(weight);
  }
});

// ---------- Inicio ----------
function init() {
  if (state) {
    showMain();
  } else {
    onboardingScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
  }
  registerServiceWorker();
}

startBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const weight = parseFloat(weightInput.value);
  const goal = parseInt(goalInput.value, 10);

  if (!name || !weight || weight <= 0 || !goal || goal <= 0) {
    alert("Completá tu nombre, tu peso y una meta diaria válida.");
    return;
  }

  state = {
    name,
    weightKg: weight,
    goalMl: goal,
    currentMl: 0,
    startHour: startHourInput.value || "09:00",
    endHour: endHourInput.value || "18:00",
    intervalMinutes: parseInt(intervalInput.value, 10) || 60,
    remindersEnabled: true,
    lastDay: todayKey(),
  };
  saveState(state);

  requestNotificationPermission();
  showMain();
});

function showMain() {
  onboardingScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  renderMain();
  scheduleReminders();

  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(() => subscribeToPush());
    }
  }
}

// ---------- Toggle de recordatorios (on/off) ----------
function renderReminderToggle() {
  const enabled = state.remindersEnabled !== false; // por compatibilidad con estados guardados antes de este cambio
  reminderToggleBtn.setAttribute("aria-checked", enabled ? "true" : "false");
  reminderStatusLabel.textContent = enabled ? "Recordatorios activos" : "Recordatorios pausados";
}

reminderToggleBtn.addEventListener("click", () => {
  state.remindersEnabled = !(state.remindersEnabled !== false);
  saveState(state);
  renderReminderToggle();

  if (state.remindersEnabled) {
    scheduleReminders();
  } else if (reminderTimer) {
    clearInterval(reminderTimer); // corta también el recordatorio local, no solo el push
  }

  subscribeToPush(); // avisa al backend del nuevo estado para que no siga mandando push
});

// ---------- Render ----------
function renderMain() {
  userNameEl.textContent = state.name;
  renderReminderToggle();
  currentMlEl.textContent = state.currentMl;
  goalMlEl.textContent = state.goalMl;

  const pct = Math.min(state.currentMl / state.goalMl, 1);
  const offset = RING_CIRCUMFERENCE * (1 - pct);
  ringProgress.style.strokeDashoffset = offset;

  footStart.textContent = state.startHour;
  footEnd.textContent = state.endHour;
  footInterval.textContent = state.intervalMinutes;

  if (pct >= 1) {
    statusMsg.textContent = "¡Meta del día cumplida! 💧";
  } else {
    statusMsg.textContent = "";
  }
}

// ---------- Carga rápida de agua ----------
document.querySelectorAll(".qty-btn[data-ml]").forEach((btn) => {
  btn.addEventListener("click", () => addWater(parseInt(btn.dataset.ml, 10)));
});

document.getElementById("customBtn").addEventListener("click", () => {
  const val = prompt("¿Cuántos ml tomaste?");
  const ml = parseInt(val, 10);
  if (ml > 0) addWater(ml);
});

function addWater(ml) {
  state.currentMl += ml;
  saveState(state);
  renderMain();
}

// ---------- Configuración ----------
settingsBtn.addEventListener("click", () => {
  editName.value = state.name;
  editWeight.value = state.weightKg || "";
  editGoal.value = state.goalMl;
  editStart.value = state.startHour;
  editEnd.value = state.endHour;
  editInterval.value = state.intervalMinutes;
  editGoalTouchedManually = false; // al reabrir el modal, permitimos que el peso vuelva a sugerir
  settingsModal.classList.remove("hidden");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", () => {
  state.name = editName.value.trim() || state.name;
  state.weightKg = parseFloat(editWeight.value) || state.weightKg;
  state.goalMl = parseInt(editGoal.value, 10) || state.goalMl;
  state.startHour = editStart.value || state.startHour;
  state.endHour = editEnd.value || state.endHour;
  state.intervalMinutes = parseInt(editInterval.value, 10) || state.intervalMinutes;
  saveState(state);
  renderMain();
  scheduleReminders();
  subscribeToPush(); // actualiza la configuración en el servidor de push
  settingsModal.classList.add("hidden");
});

resetDayBtn.addEventListener("click", () => {
  if (confirm("¿Reiniciar el consumo de hoy a 0 ml?")) {
    state.currentMl = 0;
    saveState(state);
    renderMain();
  }
});

// ---------- Recordatorios ----------
async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission === "granted") {
    if (navigator.serviceWorker) {
      await navigator.serviceWorker.ready;
    }
    await subscribeToPush();
  }
}

function isWithinWorkHours() {
  const now = new Date();
  const [startH, startM] = state.startHour.split(":").map(Number);
  const [endH, endM] = state.endHour.split(":").map(Number);
  const start = new Date(now);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(now);
  end.setHours(endH, endM, 0, 0);
  return now >= start && now <= end;
}

let pushIsActive = false;

function scheduleReminders() {
  if (reminderTimer) clearInterval(reminderTimer);
  if (state.remindersEnabled === false) return; // apagado por el usuario, no programamos nada

  const intervalMs = state.intervalMinutes * 60 * 1000;
  reminderTimer = setInterval(() => {
    if (state.remindersEnabled === false) return;
    if (!isWithinWorkHours()) return;
    if (pushIsActive) return; // el servidor ya se encarga, evitamos duplicar
    sendReminder();
  }, intervalMs);
}

function sendReminder() {
  const remaining = Math.max(state.goalMl - state.currentMl, 0);
  const title = "💧 Hora de hidratarte";
  const body = remaining > 0
    ? `${state.name}, te faltan ${remaining} ml para tu meta de hoy.`
    : `${state.name}, ¡ya cumpliste tu meta! Un vaso más no viene mal.`;

  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, { body, icon: "icons/icon-192.png" });
      });
    } else {
      new Notification(title, { body });
    }
  } else {
    statusMsg.textContent = body;
  }
}

// ---------- Service worker + Push real ----------
let swRegistration = null;

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        swRegistration = reg;
      })
      .catch(() => {
        // Falla silenciosa: la app sigue funcionando sin SW (sin notificaciones enriquecidas)
      });
  }
}

async function subscribeToPush() {
  if (!swRegistration || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const keyRes = await fetch(`${BACKEND_URL}/vapid-public-key`);
    const { publicKey } = await keyRes.json();

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await fetch(`${BACKEND_URL}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscriptionToJSON(subscription),
        settings: {
          name: state.name,
          weightKg: state.weightKg,
          goalMl: state.goalMl,
          startHour: state.startHour,
          endHour: state.endHour,
          intervalMinutes: state.intervalMinutes,
          remindersEnabled: state.remindersEnabled !== false,
        },
      }),
    });

    pushIsActive = true;
  } catch (e) {
    // Si el backend no está disponible, la app sigue funcionando con el recordatorio local
    pushIsActive = false;
    console.warn("No se pudo suscribir a push:", e);
  }
}

init();
