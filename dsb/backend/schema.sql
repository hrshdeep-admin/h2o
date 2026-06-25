-- Drive Ready Driving School — D1 Database Schema
-- Run with: wrangler d1 execute driving-booking-db --file=./schema.sql

-- Table to store user bookings
CREATE TABLE IF NOT EXISTS Appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    classes_needed INTEGER NOT NULL,
    current_license TEXT,
    appointment_date DATE NOT NULL,
    time_slot TEXT NOT NULL, -- e.g. '09:00 AM'
    status TEXT DEFAULT 'Pending', -- 'Pending', 'Confirmed', 'Cancelled'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to manage custom availability (blocking out days/times)
CREATE TABLE IF NOT EXISTS ScheduleOverrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    override_date DATE,       -- NULL means it applies every week
    day_of_week INTEGER,      -- 0 = Sunday … 6 = Saturday, used when override_date IS NULL
    time_slot TEXT NOT NULL,  -- specific slot, or 'all day'
    is_available BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON Appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_overrides_date ON ScheduleOverrides(override_date);
