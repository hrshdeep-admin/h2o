// CORS handling — required since the frontend (Cloudflare Pages) and
// the API (Cloudflare Workers) live on different subdomains.

// UPDATED: Changed from "*" to your specific domain to support 
// credentials (cookies/auth) required by Cloudflare Access.
const ALLOWED_ORIGIN = "https://h2opressurewashing.ca";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true", // Required for 'credentials: include'
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
  return new Response(null, { 
    status: 204, 
    headers: corsHeaders() 
  });
}
