// Availability logic.
// Default availability: Monday–Saturday, 9 AM–6 PM, in 1-hour slots,
// unless an override exists in ScheduleOverrides or the slot is already
// booked in Appointments. (Per the project brief's note on Phase 1.)

const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]; // 9 AM through 5 PM start times (last lesson ends 6 PM)

function formatSlot(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour > 12 ? hour - 12 : hour;
  return `${String(displayHour).padStart(2, "0")}:00 ${period}`;
}

function getDefaultSlotsForDate(dateStr) {
  // Date string is YYYY-MM-DD, parsed as local calendar date (not UTC shifted).
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = date.getDay(); // 0 = Sunday … 6 = Saturday

  if (dayOfWeek === 0) return []; // Sunday — closed by default

  return SLOT_HOURS.map(formatSlot);
}

export async function getAvailableSlots(db, dateStr) {
  let slots = getDefaultSlotsForDate(dateStr);
  if (slots.length === 0) return slots;

  // Remove slots already booked for that date (Pending or Confirmed hold the slot)
  const booked = await db
    .prepare(
      `SELECT time_slot FROM Appointments
       WHERE appointment_date = ? AND status != 'Cancelled'`
    )
    .bind(dateStr)
    .all();
  const bookedSlots = new Set((booked.results || []).map((r) => r.time_slot));

  // Remove slots blocked by ScheduleOverrides — either for this specific
  // date, or a recurring weekly block on this day of week.
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();

  const overrides = await db
    .prepare(
      `SELECT time_slot, is_available FROM ScheduleOverrides
       WHERE (override_date = ?) OR (override_date IS NULL AND day_of_week = ?)`
    )
    .bind(dateStr, dayOfWeek)
    .all();

  const blockedSlots = new Set();
  let allDayBlocked = false;
  for (const row of overrides.results || []) {
    if (row.is_available) continue; // only rows marking unavailability remove slots
    if (String(row.time_slot).toLowerCase() === "all day") {
      allDayBlocked = true;
    } else {
      blockedSlots.add(row.time_slot);
    }
  }

  if (allDayBlocked) return [];

  slots = slots.filter((slot) => !bookedSlots.has(slot) && !blockedSlots.has(slot));
  return slots;
}

export async function isSlotAvailable(db, dateStr, timeSlot) {
  const slots = await getAvailableSlots(db, dateStr);
  return slots.includes(timeSlot);
}
