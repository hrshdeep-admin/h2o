// Cloudflare Turnstile server-side verification.
// Per Phase 2: verify the token via Cloudflare's siteverify endpoint
// and reject the booking if it's invalid.

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token, secretKey, remoteIp) {
  if (!token) return false;

  const body = new FormData();
  body.append("secret", secretKey);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body,
  });

  const outcome = await res.json();
  return outcome.success === true;
}
