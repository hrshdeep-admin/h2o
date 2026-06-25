// Resend API integration.
// Per Phase 4: on a successful booking, send two emails —
// one confirmation to the client, one notification to the admin.

const RESEND_URL = "https://api.resend.com/emails";

function formatDateReadable(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend API error:", res.status, errText);
  }
  return res.ok;
}

export async function sendBookingEmails(env, booking) {
  const fromAddress = env.EMAIL_FROM || "Drive Ready <onboarding@resend.dev>";
  const adminEmail = env.ADMIN_EMAIL;
  const readableDate = formatDateReadable(booking.appointment_date);

  const clientHtml = `
    <h2>You're booked!</h2>
    <p>Hi ${booking.client_name},</p>
    <p>Your driving lesson request has been received for:</p>
    <p><strong>${readableDate} at ${booking.time_slot}</strong></p>
    <p>Classes requested: ${booking.classes_needed}</p>
    <p>We'll be in touch if anything changes. See you then!</p>
  `;

  const adminHtml = `
    <h2>New booking request</h2>
    <ul>
      <li><strong>Name:</strong> ${booking.client_name}</li>
      <li><strong>Phone:</strong> ${booking.phone}</li>
      <li><strong>Email:</strong> ${booking.email}</li>
      <li><strong>Classes needed:</strong> ${booking.classes_needed}</li>
      <li><strong>Current license:</strong> ${booking.current_license || "—"}</li>
      <li><strong>Date:</strong> ${readableDate}</li>
      <li><strong>Time slot:</strong> ${booking.time_slot}</li>
    </ul>
  `;

  await sendEmail(env.RESEND_API_KEY, {
    from: fromAddress,
    to: booking.email,
    subject: "Your driving lesson booking is confirmed",
    html: clientHtml,
  });

  if (adminEmail) {
    await sendEmail(env.RESEND_API_KEY, {
      from: fromAddress,
      to: adminEmail,
      subject: `New booking: ${booking.client_name} — ${readableDate}`,
      html: adminHtml,
    });
  }
}
