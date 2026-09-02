// ---------- Estado ----------
const STORAGE_KEY = "hidratapp_state";
const RING_CIRCUMFERENCE = 552.9; // 2 * PI * 88

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

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const resetDayBtn = document.getElementById("resetDayBtn");

const editName = document.getElementById("editName");
const editGoal = document.getElementById("editGoal");
const editStart = document.getElementById("editStart");
const editEnd = document.getElementById("editEnd");
const editInterval = document.getElementById("editInterval");

let reminderTimer = null;

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
  const goal = parseInt(goalInput.value, 10);

  if (!name || !goal || goal <= 0) {
    alert("Completá tu nombre y una meta diaria válida.");
    return;
  }

  state = {
    name,
    goalMl: goal,
    currentMl: 0,
    startHour: startHourInput.value || "09:00",
    endHour: endHourInput.value || "18:00",
    intervalMinutes: parseInt(intervalInput.value, 10) || 60,
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
}

// ---------- Render ----------
function renderMain() {
  userNameEl.textContent = state.name;
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
  editGoal.value = state.goalMl;
  editStart.value = state.startHour;
  editEnd.value = state.endHour;
  editInterval.value = state.intervalMinutes;
  settingsModal.classList.remove("hidden");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", () => {
  state.name = editName.value.trim() || state.name;
  state.goalMl = parseInt(editGoal.value, 10) || state.goalMl;
  state.startHour = editStart.value || state.startHour;
  state.endHour = editEnd.value || state.endHour;
  state.intervalMinutes = parseInt(editInterval.value, 10) || state.intervalMinutes;
  saveState(state);
  renderMain();
  scheduleReminders();
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
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
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

function scheduleReminders() {
  if (reminderTimer) clearInterval(reminderTimer);

  const intervalMs = state.intervalMinutes * 60 * 1000;
  reminderTimer = setInterval(() => {
    if (!isWithinWorkHours()) return;
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

// ---------- Service worker ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Falla silenciosa: la app sigue funcionando sin SW (sin notificaciones enriquecidas)
    });
  }
}

init();
