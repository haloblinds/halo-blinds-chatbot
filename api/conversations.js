import { Redis } from "@upstash/redis";

export const config = { runtime: "edge" };

const redis = Redis.fromEnv();

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Halo Chatbot Dashboard"',
    },
  });
}

function checkAuth(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return false;
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    if (idx === -1) return false;
    const providedPass = decoded.slice(idx + 1);
    return providedPass === password;
  } catch {
    return false;
  }
}

export default async function handler(req) {
  if (!checkAuth(req)) return unauthorized();

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "list";

  try {
    if (action === "list") {
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") || "50", 10) || 50,
        200
      );
      const ids = await redis.zrange("halo:conversations", 0, limit - 1, {
        rev: true,
      });

      const conversations = await Promise.all(
        (ids || []).map(async (id) => {
          const [meta, messages] = await Promise.all([
            redis.hgetall(`halo:conv:${id}`),
            redis.lrange(`halo:conv:${id}:messages`, 0, -1),
          ]);
          const parsed = (messages || []).map((m) => {
            try {
              return typeof m === "string" ? JSON.parse(m) : m;
            } catch {
              return { role: "unknown", content: String(m), at: 0 };
            }
          });
          return {
            id,
            updated_at: meta?.updated_at ? Number(meta.updated_at) : null,
            product_title: meta?.product_title || "",
            product_url: meta?.product_url || "",
            message_count: parsed.length,
            messages: parsed,
          };
        })
      );

      return Response.json({ conversations });
    }

    if (action === "questions") {
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") || "200", 10) || 200,
        500
      );
      const raw = await redis.lrange("halo:questions", 0, limit - 1);
      const questions = (raw || []).map((r) => {
        try {
          return typeof r === "string" ? JSON.parse(r) : r;
        } catch {
          return { q: String(r), at: 0 };
        }
      });
      return Response.json({ questions });
    }

    return new Response("Unknown action", { status: 400 });
  } catch (e) {
    console.error("[halo-dashboard]", e);
    return new Response("Server error", { status: 500 });
  }
}
