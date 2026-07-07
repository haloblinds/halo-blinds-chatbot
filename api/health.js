// Diagnostic endpoint. Hit this in your browser to verify the Vercel deploy is live.
// GET https://your-deploy.vercel.app/api/health
// Should return JSON with { ok: true, endpoints: {...}, env: {...} }
// CORS is handled at the edge in vercel.json.
export const config = { runtime: "edge" };

export default async function handler(req) {
  const body = {
    ok: true,
    now: new Date().toISOString(),
    endpoints: {
      contact: "/api/contact (POST, JSON body: name, email, message, product_context)",
      health: "/api/health (GET, diagnostic)",
    },
    env: {
      // We only report whether env vars are set, never their values, so this endpoint stays safe to leave public.
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      CONTACT_TO_EMAIL: process.env.CONTACT_TO_EMAIL || "help@haloblinds.com (default)",
      CONTACT_FROM_EMAIL: process.env.CONTACT_FROM_EMAIL || "onboarding@resend.dev (default)",
      UPSTASH_REDIS_REST_URL:
        !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
      UPSTASH_REDIS_REST_TOKEN:
        !!(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN),
      DASHBOARD_PASSWORD: !!process.env.DASHBOARD_PASSWORD,
    },
    request: {
      method: req.method,
      origin: req.headers.get("origin") || null,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 120),
    },
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
