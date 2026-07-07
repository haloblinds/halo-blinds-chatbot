import { Redis } from "@upstash/redis";

export const config = { runtime: "edge" };

function cleanEnv(v) {
  if (!v) return v;
  return v.trim().replace(/^["'](.*)["']$/, "$1").trim();
}
// CORS headers are set at the edge by vercel.json, so 404s and 500s also carry them.
// This function never touches CORS headers itself, that avoids double-headers.

let _redis = null;
function getRedis() {
  if (!_redis) {
    const url = cleanEnv(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
    const token = cleanEnv(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) throw new Error("Missing Upstash env vars");
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Post a message to the Resend API. Returns { ok, reason }.
async function resendSend(apiKey, payload) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[halo-contact] resend error", res.status, body);
      return { ok: false, reason: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[halo-contact] resend threw", e);
    return { ok: false, reason: "resend_exception" };
  }
}

// 1) Send the customer's message to the Halo team inbox.
async function sendTeamEmail({ name, email, message, product_title, product_url }) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY);
  if (!apiKey) return { ok: false, reason: "no_api_key" };

  const to = cleanEnv(process.env.CONTACT_TO_EMAIL) || "help@haloblinds.com";
  const from = cleanEnv(process.env.CONTACT_FROM_EMAIL) || "Halo Contact <onboarding@resend.dev>";

  const subject = `New question from Halo product page, ${name || "anonymous"}`;
  const text = [
    `New contact form submission from the Halo Blinds product page.`,
    ``,
    `Name:    ${name || "(not provided)"}`,
    `Email:   ${email || "(not provided)"}`,
    `Product: ${product_title || "(not provided)"}`,
    `Page:    ${product_url || "(not provided)"}`,
    ``,
    `Question:`,
    message || "(empty)",
    ``,
    `Reply directly to this email and it goes back to the customer.`,
  ].join("\n");

  const html =
    `<h2 style="margin:0 0 8px;font-family:system-ui,sans-serif">New question from the Halo product page</h2>` +
    `<p style="margin:0 0 6px;font-family:system-ui,sans-serif;color:#333"><strong>Name:</strong> ${escapeHtml(name || "(not provided)")}</p>` +
    `<p style="margin:0 0 6px;font-family:system-ui,sans-serif;color:#333"><strong>Email:</strong> ${escapeHtml(email || "(not provided)")}</p>` +
    `<p style="margin:0 0 6px;font-family:system-ui,sans-serif;color:#333"><strong>Product:</strong> ${escapeHtml(product_title || "(not provided)")}</p>` +
    `<p style="margin:0 0 12px;font-family:system-ui,sans-serif;color:#333"><strong>Page:</strong> <a href="${escapeAttr(product_url || "#")}">${escapeHtml(product_url || "(not provided)")}</a></p>` +
    `<div style="font-family:system-ui,sans-serif;background:#f4f4f4;border-radius:8px;padding:12px 14px;white-space:pre-wrap;color:#111">${escapeHtml(message || "(empty)")}</div>` +
    `<p style="margin:16px 0 0;font-family:system-ui,sans-serif;color:#888;font-size:12px">Reply directly to this email and it will go straight back to the customer.</p>`;

  return resendSend(apiKey, {
    from,
    to: [to],
    reply_to: email || undefined,
    subject,
    text,
    html,
  });
}

// 2) Send an auto-response confirmation to the customer.
async function sendCustomerAutoResponse({ name, email, message }) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY);
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  if (!email) return { ok: false, reason: "no_email" };

  const from = cleanEnv(process.env.AUTORESPONSE_FROM_EMAIL) || cleanEnv(process.env.CONTACT_FROM_EMAIL) || "Halo Blinds <onboarding@resend.dev>";
  const replyTo = cleanEnv(process.env.CONTACT_TO_EMAIL) || "help@haloblinds.com";
  const firstName = (name || "").split(/\s+/)[0] || "there";

  const subject = `We got your question, Halo Blinds`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for reaching out! We received your question and one of the Halo team will personally get back to you within 12 hours, usually much sooner.`,
    ``,
    `Your question, for reference:`,
    ``,
    (message || "").split("\n").map((l) => `> ${l}`).join("\n"),
    ``,
    `If anything else comes up in the meantime, just reply to this email and it lands straight in our team inbox.`,
    ``,
    `Speak soon,`,
    `The Halo Blinds team`,
    ``,
    `--`,
    `This is an automated confirmation. A real person will reply shortly.`,
  ].join("\n");

  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;color:#111;line-height:1.55;max-width:560px">` +
      `<p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>` +
      `<p style="margin:0 0 14px">Thanks for reaching out! We received your question and one of the Halo team will personally get back to you <strong>within 12 hours</strong>, usually much sooner.</p>` +
      `<p style="margin:16px 0 8px;color:#666;font-size:13px">Your question, for reference:</p>` +
      `<div style="background:#f4f4f4;border-left:3px solid #111;border-radius:6px;padding:12px 14px;white-space:pre-wrap;color:#111;font-size:14px">${escapeHtml(message || "")}</div>` +
      `<p style="margin:20px 0 14px">If anything else comes up in the meantime, just reply to this email and it lands straight in our team inbox.</p>` +
      `<p style="margin:0 0 4px">Speak soon,</p>` +
      `<p style="margin:0 0 20px"><strong>The Halo Blinds team</strong></p>` +
      `<p style="margin:0;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:12px">This is an automated confirmation. A real person will reply shortly.</p>` +
    `</div>`;

  return resendSend(apiKey, {
    from,
    to: [email],
    reply_to: replyTo,
    subject,
    text,
    html,
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = String(payload?.name || "").slice(0, 120).trim();
  const email = String(payload?.email || "").slice(0, 254).trim();
  const message = String(payload?.message || "").slice(0, 4000).trim();
  const product_context = payload?.product_context || {};
  const product_title = String(product_context.product_title || "").slice(0, 240);
  const product_url = String(product_context.page_url || product_context.product_url || "").slice(0, 1000);

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!message || message.length < 2) {
    return new Response(JSON.stringify({ ok: false, error: "empty_message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Send email (best effort) and log to Redis for the dashboard
  const now = Date.now();
  const [teamEmailResult] = await Promise.all([
    sendTeamEmail({ name, email, message, product_title, product_url }),
    (async () => {
      try {
        const redis = getRedis();
        const id = `req_${now}_${Math.random().toString(36).slice(2, 8)}`;
        const entry = { id, name, email, message, product_title, product_url, at: now };
        await redis.lpush("halo:contact_requests", JSON.stringify(entry));
        await redis.ltrim("halo:contact_requests", 0, 999);
        // Also store in the "conversations" shape so the existing dashboard shows them
        await redis.zadd("halo:conversations", { score: now, member: id });
        await redis.hset(`halo:conv:${id}`, {
          updated_at: now,
          product_url,
          product_title,
        });
        await redis.rpush(
          `halo:conv:${id}:messages`,
          JSON.stringify({ role: "user", content: `${name} <${email}>\n\n${message}`, at: now })
        );
        await redis.expire(`halo:conv:${id}`, 60 * 60 * 24 * 90);
        await redis.expire(`halo:conv:${id}:messages`, 60 * 60 * 24 * 90);
      } catch (e) {
        console.error("[halo-contact] redis log failed", e);
      }
    })(),
  ]);

  // We treat the submission as successful for the user even if email sending is misconfigured,
  // because it's still logged in Redis and visible in the dashboard.
  return new Response(
    JSON.stringify({
      ok: true,
      team_email_sent: teamEmailResult.ok,
      reason: teamEmailResult.reason || null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
