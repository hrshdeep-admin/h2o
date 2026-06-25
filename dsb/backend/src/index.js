// Drive Ready — Cloudflare Worker API
// Implements the endpoints defined in Phase 2 of the project brief:
//   GET  /api/availability?date=YYYY-MM-DD
//   POST /api/book
//   GET  /api/admin/appointments
//   PUT  /api/admin/appointments/:id
//   POST /api/admin/overrides
//
// Admin routes are protected by Cloudflare Zero Trust (Access) at the
// network level (Phase 6) — no auth logic is implemented here by design.

import { corsHeaders, jsonResponse, handleOptions } from "./cors.js";
import { getAvailableSlots, isSlotAvailable } from "./availability.js";
import { verifyTurnstileToken } from "./turnstile.js";
import { sendBookingEmails } from "./email.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return handleOptions();
    }

    try {
      // GET /api/availability?date=YYYY-MM-DD
      if (pathname === "/api/availability" && method === "GET") {
        return await handleGetAvailability(request, env);
      }

      // POST /api/book
      if (pathname === "/api/book" && method === "POST") {
        return await handleBook(request, env);
      }

      // GET /api/admin/appointments
      if (pathname === "/api/admin/appointments" && method === "GET") {
        return await handleGetAppointments(env);
      }

      // PUT /api/admin/appointments/:id
      const appointmentMatch = pathname.match(/^\/api\/admin\/appointments\/(\d+)$/);
      if (appointmentMatch && method === "PUT") {
        return await handleUpdateAppointment(request, env, appointmentMatch[1]);
      }

      // POST /api/admin/overrides
      if (pathname === "/api/admin/overrides" && method === "POST") {
        return await handleAddOverride(request, env);
      }

      // GET /api/admin/overrides
      if (pathname === "/api/admin/overrides" && method === "GET") {
        return await handleGetOverrides(env);
      }

      // DELETE /api/admin/overrides/:id
      const overrideMatch = pathname.match(/^\/api\/admin\/overrides\/(\d+)$/);
      if (overrideMatch && method === "DELETE") {
        return await handleDeleteOverride(env, overrideMatch[1]);
      }

      // DELETE /api/admin/appointments/:id
      if (appointmentMatch && method === "DELETE") {
        return await handleDeleteAppointment(env, appointmentMatch[1]);
      }

      return jsonResponse({ message: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ message: "Internal server error" }, 500);
    }
  },
};

// ---- GET /api/availability ----------------------------------------------
async function handleGetAvailability(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ message: "A valid 'date' query parameter (YYYY-MM-DD) is required." }, 400);
  }

  const slots = await getAvailableSlots(env.DB, date);
  return jsonResponse({ slots });
}

// ---- POST /api/book --------------------------------------------------------
async function handleBook(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return jsonResponse({ message: "Invalid JSON body." }, 400);
  }

  const {
    client_name,
    phone,
    email,
    classes_needed,
    current_license,
    appointment_date,
    time_slot,
    turnstile_token,
  } = payload;

  // Basic required-field validation
  if (!client_name || !phone || !email || !classes_needed || !appointment_date || !time_slot) {
    return jsonResponse({ message: "Missing required booking fields." }, 400);
  }

  // 1. Verify the Turnstile token
  const turnstileValid = await verifyTurnstileToken(
    turnstile_token,
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP")
  );
  if (!turnstileValid) {
    return jsonResponse({ message: "Verification failed. Please try again." }, 403);
  }

  // 2. Double-check the slot is still available
  const stillAvailable = await isSlotAvailable(env.DB, appointment_date, time_slot);
  if (!stillAvailable) {
    return jsonResponse({ message: "That time slot is no longer available." }, 409);
  }

  // 3. Insert the booking
  const insertResult = await env.DB.prepare(
    `INSERT INTO Appointments
       (client_name, phone, email, classes_needed, current_license, appointment_date, time_slot, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`
  )
    .bind(client_name, phone, email, classes_needed, current_license || null, appointment_date, time_slot)
    .run();

  const booking = {
    id: insertResult.meta.last_row_id,
    client_name,
    phone,
    email,
    classes_needed,
    current_license,
    appointment_date,
    time_slot,
  };

  // 4. Send confirmation emails (client + admin)
  await sendBookingEmails(env, booking);

  return jsonResponse({ message: "Booking confirmed.", appointment: booking }, 201);
}

// ---- GET /api/admin/appointments -------------------------------------------
async function handleGetAppointments(env) {
  const result = await env.DB.prepare(
    `SELECT * FROM Appointments ORDER BY appointment_date ASC, time_slot ASC`
  ).all();

  return jsonResponse({ appointments: result.results || [] });
}

// ---- PUT /api/admin/appointments/:id ----------------------------------------
async function handleUpdateAppointment(request, env, id) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return jsonResponse({ message: "Invalid JSON body." }, 400);
  }

  const existing = await env.DB.prepare(`SELECT * FROM Appointments WHERE id = ?`).bind(id).first();
  if (!existing) {
    return jsonResponse({ message: "Appointment not found." }, 404);
  }

  const status = payload.status ?? existing.status;
  const appointment_date = payload.appointment_date ?? existing.appointment_date;
  const time_slot = payload.time_slot ?? existing.time_slot;

  await env.DB.prepare(
    `UPDATE Appointments
     SET status = ?, appointment_date = ?, time_slot = ?
     WHERE id = ?`
  )
    .bind(status, appointment_date, time_slot, id)
    .run();

  const updated = await env.DB.prepare(`SELECT * FROM Appointments WHERE id = ?`).bind(id).first();
  return jsonResponse({ message: "Appointment updated.", appointment: updated });
}

// ---- POST /api/admin/overrides --------------------------------------------
async function handleAddOverride(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return jsonResponse({ message: "Invalid JSON body." }, 400);
  }

  const { override_date, day_of_week, time_slot, is_available } = payload;

  if (!time_slot) {
    return jsonResponse({ message: "'time_slot' is required." }, 400);
  }
  if (!override_date && day_of_week === undefined) {
    return jsonResponse({ message: "Either 'override_date' or 'day_of_week' must be provided." }, 400);
  }

  const insertResult = await env.DB.prepare(
    `INSERT INTO ScheduleOverrides (override_date, day_of_week, time_slot, is_available)
     VALUES (?, ?, ?, ?)`
  )
    .bind(override_date || null, day_of_week ?? null, time_slot, is_available ? 1 : 0)
    .run();

  return jsonResponse(
    {
      message: "Schedule override added.",
      override: { id: insertResult.meta.last_row_id, override_date, day_of_week, time_slot, is_available: !!is_available },
    },
    201
  );
}

// ---- GET /api/admin/overrides --------------------------------------------
async function handleGetOverrides(env) {
  const result = await env.DB.prepare(
    `SELECT * FROM ScheduleOverrides ORDER BY id DESC`
  ).all();

  return jsonResponse({ overrides: result.results || [] });
}

// ---- DELETE /api/admin/overrides/:id --------------------------------------
async function handleDeleteOverride(env, id) {
  const result = await env.DB.prepare(
    `DELETE FROM ScheduleOverrides WHERE id = ?`
  ).bind(id).run();

  if (result.meta.changes === 0) {
    return jsonResponse({ message: "Override not found." }, 404);
  }
  return jsonResponse({ message: "Override deleted." });
}

// ---- DELETE /api/admin/appointments/:id -----------------------------------
async function handleDeleteAppointment(env, id) {
  const result = await env.DB.prepare(
    `DELETE FROM Appointments WHERE id = ?`
  ).bind(id).run();

  if (result.meta.changes === 0) {
    return jsonResponse({ message: "Appointment not found." }, 404);
  }
  return jsonResponse({ message: "Appointment deleted." });
}
