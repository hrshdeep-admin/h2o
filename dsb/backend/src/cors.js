// CORS handling — required since the frontend (Cloudflare Pages) and
// the API (Cloudflare Workers) live on different subdomains.

// Set this to your actual Pages domain in production, e.g.
// "https://driving-school.pages.dev". "*" works for development.
const ALLOWED_ORIGIN = "*";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
