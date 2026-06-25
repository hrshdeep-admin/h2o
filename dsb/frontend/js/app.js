/* =========================================================
   Drive Ready — Public Booking Page
   Handles: step navigation, dynamic availability fetch,
   Turnstile token capture, validation, and submission.
   ========================================================= */

// ---- Configuration ---------------------------------------------------
// Point this at your deployed Cloudflare Worker.
const API_BASE_URL = "  https://driving-school-api.harshdeep-inbox.workers.dev";

// ---- State -------------------------------------------------------------
let currentStep = 1;
const TOTAL_STEPS = 3;
let turnstileToken = null;
let isSubmitting = false;

// ---- DOM refs ------------------------------------------------------------
const form = document.getElementById("bookingForm");
const progressSteps = Array.from(document.querySelectorAll(".progress-road .step"));
const formSteps = Array.from(document.querySelectorAll(".form-step"));
const dateInput = document.getElementById("appointmentDate");
const timeSlotSelect = document.getElementById("timeSlot");
const availabilityHint = document.getElementById("availabilityHint");
const submitBtn = document.getElementById("submitBtn");
const formResult = document.getElementById("formResult");
const summaryList = document.getElementById("summaryList");
const turnstileError = document.getElementById("turnstileError");

document.getElementById("year").textContent = new Date().getFullYear();

// Restrict date picker to today .. +90 days, closed Sundays handled server-side too
(function setDateBounds() {
  const today = new Date();
  const max = new Date();
  max.setDate(max.getDate() + 90);
  dateInput.min = today.toISOString().split("T")[0];
  dateInput.max = max.toISOString().split("T")[0];
})();

// ---- Turnstile callback (referenced by data-callback in HTML) ----------
window.onTurnstileSuccess = function (token) {
  turnstileToken = token;
  turnstileError.textContent = "";
};

// ---- Step navigation -----------------------------------------------------
function goToStep(step) {
  if (step === 3) {
    if (!validateStep(currentStep)) return;
    buildSummary();
  } else if (step > currentStep) {
    if (!validateStep(currentStep)) return;
  }

  currentStep = step;

  formSteps.forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.step) === step);
  });

  progressSteps.forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle("is-active", n === step);
    el.classList.toggle("is-complete", n < step);
  });

  // Move focus to the new step's first field for accessibility
  const activeFieldset = document.querySelector(`.form-step[data-step="${step}"]`);
  const firstField = activeFieldset.querySelector("input, select");
  if (firstField) firstField.focus({ preventScroll: true });

  document.getElementById("book").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll('[data-action="next"]').forEach((btn) => {
  btn.addEventListener("click", () => goToStep(currentStep + 1));
});
document.querySelectorAll('[data-action="back"]').forEach((btn) => {
  btn.addEventListener("click", () => goToStep(currentStep - 1));
});

// ---- Validation -----------------------------------------------------------
function setFieldError(input, message) {
  const field = input.closest(".field");
  const errorEl = field?.querySelector(".field-error");
  if (errorEl) errorEl.textContent = message || "";
  field?.classList.toggle("has-error", Boolean(message));
}

function validateStep(step) {
  let valid = true;
  const fieldset = document.querySelector(`.form-step[data-step="${step}"]`);
  const inputs = fieldset.querySelectorAll("input[required], select[required]");

  inputs.forEach((input) => {
    let message = "";
    if (!input.value.trim()) {
      message = "This field is required.";
    } else if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
      message = "Enter a valid email address.";
    } else if (input.type === "tel" && input.value.replace(/\D/g, "").length < 7) {
      message = "Enter a valid phone number.";
    }
    setFieldError(input, message);
    if (message) valid = false;
  });

  return valid;
}

// ---- Dynamic availability (Phase 3 requirement) ---------------------------
dateInput.addEventListener("change", async () => {
  const date = dateInput.value;
  setFieldError(timeSlotSelect, "");

  if (!date) {
    resetTimeSlotSelect("Choose a date first…");
    return;
  }

  resetTimeSlotSelect("Loading available times…");
  timeSlotSelect.disabled = true;
  availabilityHint.textContent = "Checking availability…";

  try {
    const res = await fetch(`${API_BASE_URL}/api/availability?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    const slots = Array.isArray(data?.slots) ? data.slots : Array.isArray(data) ? data : [];
    populateTimeSlots(slots);
  } catch (err) {
    resetTimeSlotSelect("Couldn't load times — try again");
    availabilityHint.textContent = "We couldn't reach the booking server. Please try selecting the date again.";
    console.error("Availability fetch failed:", err);
  }
});

function resetTimeSlotSelect(placeholder) {
  timeSlotSelect.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
  timeSlotSelect.disabled = true;
}

function populateTimeSlots(slots) {
  if (!slots.length) {
    resetTimeSlotSelect("No times available that day");
    availabilityHint.textContent = "That day is fully booked. Please choose another date.";
    return;
  }
  timeSlotSelect.innerHTML = `<option value="" disabled selected>Choose a time…</option>`;
  slots.forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = slot;
    timeSlotSelect.appendChild(option);
  });
  timeSlotSelect.disabled = false;
  availabilityHint.textContent = `${slots.length} time slot${slots.length === 1 ? "" : "s"} available.`;
}

// ---- Build confirmation summary (step 3) -----------------------------------
function buildSummary() {
  const formData = new FormData(form);
  const licenseLabels = {
    none: "No license / permit yet",
    learner: "Learner's permit",
    provisional: "Provisional / restricted license",
    full: "Full license (refresher lessons)",
  };
  const classLabels = {
    1: "1 class",
    5: "5-class package",
    10: "10-class package",
    20: "20-class package (full course)",
  };

  const rows = [
    ["Name", formData.get("client_name")],
    ["Phone", formData.get("phone")],
    ["Email", formData.get("email")],
    ["Classes", classLabels[formData.get("classes_needed")] || formData.get("classes_needed")],
    ["License", licenseLabels[formData.get("current_license")] || formData.get("current_license")],
    ["Date", formatDate(formData.get("appointment_date"))],
    ["Time", formData.get("time_slot")],
  ];

  summaryList.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHTML(value || "—")}</dd>`)
    .join("");
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Submission (Phase 3 requirement) ---------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  if (!validateStep(2) || !validateStep(1)) {
    turnstileError.textContent = "";
    return;
  }

  if (!turnstileToken) {
    turnstileError.textContent = "Please complete the verification challenge above.";
    return;
  }

  const formData = new FormData(form);
  const payload = {
    client_name: formData.get("client_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    classes_needed: Number(formData.get("classes_needed")),
    current_license: formData.get("current_license"),
    appointment_date: formData.get("appointment_date"),
    time_slot: formData.get("time_slot"),
    turnstile_token: turnstileToken,
  };

  setLoading(true);

  try {
    const res = await fetch(`${API_BASE_URL}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message =
        res.status === 409
          ? "That time slot was just taken. Please pick another."
          : data?.message || "Something went wrong. Please try again.";
      throw new Error(message);
    }

    showResult({
      success: true,
      title: "You're booked!",
      message: `We've sent a confirmation to ${payload.email}. See you ${formatDate(payload.appointment_date)} at ${payload.time_slot}.`,
    });
  } catch (err) {
    showResult({
      success: false,
      title: "Couldn't complete your booking",
      message: err.message || "Please try again, or contact us directly if the problem continues.",
    });
    console.error("Booking submission failed:", err);
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  submitBtn.classList.toggle("is-loading", loading);
}

function showResult({ success, title, message }) {
  form.hidden = true;
  formResult.hidden = false;
  formResult.className = `form-result ${success ? "is-success" : "is-error"}`;
  formResult.innerHTML = `
    <div class="result-icon" aria-hidden="true">
      ${
        success
          ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#1f7a4d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8v5M12 16h.01" stroke="#b3261e" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="#b3261e" stroke-width="2"/></svg>'
      }
    </div>
    <h3>${escapeHTML(title)}</h3>
    <p>${escapeHTML(message)}</p>
    ${!success ? '<button type="button" class="btn btn-primary" id="retryBtn">Try again</button>' : ""}
  `;

  if (!success) {
    document.getElementById("retryBtn").addEventListener("click", () => {
      formResult.hidden = true;
      form.hidden = false;
    });
  }
}
