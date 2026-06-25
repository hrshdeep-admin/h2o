/* =========================================================
   Drive Ready — Admin Portal
   Fetches appointments into FullCalendar, manages the
   detail/edit modal, and the schedule overrides modal.

   Auth note: this page sits behind Cloudflare Zero Trust
   (Phase 6). No login form here — Cloudflare Access already
   verified the admin's identity before this page loads.
   Every fetch below relies on the CF_Authorization cookie
   that Access sets, so credentials: "include" is required.
   ========================================================= */

const API_BASE_URL = "https://driving-school-api.harshdeep-inbox.workers.dev";

const STATUS_CLASS = {
  Pending: "status-pending",
  Confirmed: "status-confirmed",
  Cancelled: "status-cancelled",
};

let calendar;
let appointmentsCache = [];
let selectedAppointmentId = null;

// ---- DOM refs ----------------------------------------------------------
const statusBar = document.getElementById("statusBar");
const appointmentModal = document.getElementById("appointmentModal");
const overridesModal = document.getElementById("overridesModal");

document.addEventListener("DOMContentLoaded", () => {
  initCalendar();
  loadAppointments();
  bindModalControls();
  bindOverridesControls();

  document.getElementById("refreshBtn").addEventListener("click", () => loadAppointments());
  document.getElementById("manageOverridesBtn").addEventListener("click", openOverridesModal);
});

// ---- API helper ----------------------------------------------------------
async function apiFetch(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    credentials: 'include', // This is why you need the change above!
    headers: {
      ...options.headers,
      'Content-Type': 'application/json'
    }
  });

  if (res.status === 401 || res.status === 403) {
    showStatus("Your admin session expired. Refresh the page to sign in again.", true);
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return res.json();
}

function showStatus(message, isError = false) {
  statusBar.textContent = message;
  statusBar.hidden = false;
  statusBar.classList.toggle("is-error", isError);
  if (!isError) {
    setTimeout(() => { statusBar.hidden = true; }, 3500);
  }
}

// ---- Calendar setup --------------------------------------------------------
function initCalendar() {
  const calendarEl = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "timeGridWeek",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,listWeek",
    },
    slotMinTime: "08:00:00",
    slotMaxTime: "19:00:00",
    height: "auto",
    nowIndicator: true,
    firstDay: 1,
    eventClick: (info) => openAppointmentModal(info.event.id),
  });
  calendar.render();
}

// ---- Load + map appointments ------------------------------------------------
async function loadAppointments() {
  try {
    const data = await apiFetch("/api/admin/appointments");
    appointmentsCache = Array.isArray(data?.appointments) ? data.appointments : Array.isArray(data) ? data : [];
    renderEvents();
    renderStats();
  } catch (err) {
    if (err.message !== "Unauthorized") {
      showStatus("Couldn't load appointments. " + err.message, true);
    }
    console.error("Failed to load appointments:", err);
  }
}

function renderEvents() {
  calendar.removeAllEvents();
  appointmentsCache.forEach((appt) => {
    const start = combineDateTime(appt.appointment_date, appt.time_slot);
    calendar.addEvent({
      id: String(appt.id),
      title: `${appt.client_name} — ${appt.status}`,
      start,
      classNames: [STATUS_CLASS[appt.status] || "status-pending"],
      extendedProps: { ...appt },
    });
  });
}

function combineDateTime(dateStr, timeStr) {
  // timeStr expected like "09:00 AM"; falls back gracefully if format differs
  if (!dateStr) return null;
  if (!timeStr) return dateStr;

  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return dateStr;

  let [, hh, mm, ampm] = match;
  hh = Number(hh);
  if (ampm) {
    if (ampm.toUpperCase() === "PM" && hh !== 12) hh += 12;
    if (ampm.toUpperCase() === "AM" && hh === 12) hh = 0;
  }
  return `${dateStr}T${String(hh).padStart(2, "0")}:${mm}:00`;
}

function renderStats() {
  const todayStr = new Date().toISOString().split("T")[0];
  const startOfWeek = getStartOfWeek();

  const pending = appointmentsCache.filter((a) => a.status === "Pending").length;
  const confirmed = appointmentsCache.filter((a) => a.status === "Confirmed").length;
  const weekTotal = appointmentsCache.filter((a) => a.appointment_date >= startOfWeek).length;

  document.getElementById("statPending").textContent = pending;
  document.getElementById("statConfirmed").textContent = confirmed;
  document.getElementById("statTotal").textContent = weekTotal;
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

// ---- Appointment detail / edit modal -------------------------------------
function bindModalControls() {
  document.getElementById("closeModalBtn").addEventListener("click", closeAppointmentModal);
  document.getElementById("cancelEditBtn").addEventListener("click", closeAppointmentModal);
  document.getElementById("saveAppointmentBtn").addEventListener("click", saveAppointment);
  document.getElementById("deleteAppointmentBtn").addEventListener("click", deleteAppointment);
  appointmentModal.addEventListener("click", (e) => {
    if (e.target === appointmentModal) closeAppointmentModal();
  });
}

function openAppointmentModal(id) {
  const appt = appointmentsCache.find((a) => String(a.id) === String(id));
  if (!appt) return;
  selectedAppointmentId = appt.id;

  document.getElementById("modalTitle").textContent = appt.client_name;
  document.getElementById("detailList").innerHTML = `
    <dt>Phone</dt><dd>${escapeHTML(appt.phone)}</dd>
    <dt>Email</dt><dd>${escapeHTML(appt.email)}</dd>
    <dt>Classes</dt><dd>${escapeHTML(String(appt.classes_needed ?? "—"))}</dd>
    <dt>License</dt><dd>${escapeHTML(appt.current_license || "—")}</dd>
    <dt>Booked</dt><dd>${appt.created_at ? new Date(appt.created_at).toLocaleString() : "—"}</dd>
  `;
  document.getElementById("editStatus").value = appt.status || "Pending";
  document.getElementById("editDate").value = appt.appointment_date || "";
  document.getElementById("editTime").value = appt.time_slot || "";

  appointmentModal.hidden = false;
}

function closeAppointmentModal() {
  appointmentModal.hidden = true;
  selectedAppointmentId = null;
}

async function saveAppointment() {
  if (!selectedAppointmentId) return;
  const payload = {
    status: document.getElementById("editStatus").value,
    appointment_date: document.getElementById("editDate").value,
    time_slot: document.getElementById("editTime").value,
  };

  try {
    await apiFetch(`/api/admin/appointments/${selectedAppointmentId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    showStatus("Appointment updated.");
    closeAppointmentModal();
    loadAppointments();
  } catch (err) {
    if (err.message !== "Unauthorized") showStatus("Couldn't save changes. " + err.message, true);
  }
}

async function deleteAppointment() {
  if (!selectedAppointmentId) return;
  const confirmed = window.confirm("Delete this appointment? This can't be undone.");
  if (!confirmed) return;

  try {
    await apiFetch(`/api/admin/appointments/${selectedAppointmentId}`, { method: "DELETE" });
    showStatus("Appointment deleted.");
    closeAppointmentModal();
    loadAppointments();
  } catch (err) {
    if (err.message !== "Unauthorized") showStatus("Couldn't delete appointment. " + err.message, true);
  }
}

// ---- Schedule overrides modal ----------------------------------------------
function bindOverridesControls() {
  document.getElementById("closeOverridesBtn").addEventListener("click", closeOverridesModal);
  overridesModal.addEventListener("click", (e) => {
    if (e.target === overridesModal) closeOverridesModal();
  });

  const overrideType = document.getElementById("overrideType");
  overrideType.addEventListener("change", () => {
    const isRecurring = overrideType.value === "recurring";
    document.getElementById("overrideDateField").hidden = isRecurring;
    document.getElementById("overrideDayField").hidden = !isRecurring;
  });

  document.getElementById("overrideForm").addEventListener("submit", addOverride);
}

function openOverridesModal() {
  overridesModal.hidden = false;
  loadOverrides();
}
function closeOverridesModal() {
  overridesModal.hidden = true;
}

async function loadOverrides() {
  const list = document.getElementById("overridesList");
  list.innerHTML = `<li class="overrides-empty">Loading…</li>`;
  try {
    const data = await apiFetch("/api/admin/overrides");
    const overrides = Array.isArray(data?.overrides) ? data.overrides : Array.isArray(data) ? data : [];
    renderOverridesList(overrides);
  } catch (err) {
    list.innerHTML = `<li class="overrides-empty">Couldn't load blocks.</li>`;
    if (err.message !== "Unauthorized") console.error(err);
  }
}

function renderOverridesList(overrides) {
  const list = document.getElementById("overridesList");
  if (!overrides.length) {
    list.innerHTML = `<li class="overrides-empty">No blocks set.</li>`;
    return;
  }
  list.innerHTML = overrides
    .map((o) => {
      const label = o.override_date
        ? `${o.override_date} — ${escapeHTML(o.time_slot)}`
        : `Every ${dayName(o.day_of_week)} — ${escapeHTML(o.time_slot)}`;
      return `<li><span>${label}</span><button class="override-remove" data-id="${o.id}">Remove</button></li>`;
    })
    .join("");

  list.querySelectorAll(".override-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeOverride(btn.dataset.id));
  });
}

function dayName(dow) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[Number(dow)] || "—";
}

async function addOverride(e) {
  e.preventDefault();
  const type = document.getElementById("overrideType").value;
  const timeSlot = document.getElementById("overrideTimeSlot").value.trim();

  if (!timeSlot) return;

  const payload =
    type === "recurring"
      ? { override_date: null, day_of_week: Number(document.getElementById("overrideDay").value), time_slot: timeSlot, is_available: false }
      : { override_date: document.getElementById("overrideDate").value, time_slot: timeSlot, is_available: false };

  if (type === "date" && !payload.override_date) {
    showStatus("Choose a date for this block.", true);
    return;
  }

  try {
    await apiFetch("/api/admin/overrides", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("overrideForm").reset();
    document.getElementById("overrideDateField").hidden = false;
    document.getElementById("overrideDayField").hidden = true;
    showStatus("Schedule block added.");
    loadOverrides();
    loadAppointments();
  } catch (err) {
    if (err.message !== "Unauthorized") showStatus("Couldn't add block. " + err.message, true);
  }
}

async function removeOverride(id) {
  try {
    await apiFetch(`/api/admin/overrides/${id}`, { method: "DELETE" });
    showStatus("Block removed.");
    loadOverrides();
    loadAppointments();
  } catch (err) {
    if (err.message !== "Unauthorized") showStatus("Couldn't remove block. " + err.message, true);
  }
}

// ---- Utility ----------------------------------------------------------------
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
