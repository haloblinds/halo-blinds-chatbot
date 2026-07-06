// Local dev server — emulates the Vercel Edge endpoints in plain Node.
// Run: `node dev-server.js`  (or `npm run dev`)
// Serves the widget test page at http://localhost:4848
// If ANTHROPIC_API_KEY + KV_REST_API_URL/TOKEN are set, uses real Claude + Upstash.
// Otherwise runs in mock mode (pre-scripted replies, in-memory storage).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env.local into process.env (no dependency on dotenv)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1").trim();
    }
  }
}

const PORT = Number(process.env.PORT || 4848);
const LIVE_MODE = Boolean(
  process.env.ANTHROPIC_API_KEY &&
    process.env.KV_REST_API_URL &&
    process.env.KV_REST_API_TOKEN
);

// ---- In-memory mock storage ----
const mockConversations = new Map();
const mockQuestions = [];

function mockRedis() {
  return {
    async zadd(key, { score, member }) {
      // no-op — mock only needs conversations map + questions array
    },
    async hset(key, obj) {
      const id = key.replace("halo:conv:", "");
      const existing = mockConversations.get(id) || { id, messages: [] };
      Object.assign(existing, obj);
      mockConversations.set(id, existing);
    },
    async rpush(key, val) {
      if (key.startsWith("halo:conv:") && key.endsWith(":messages")) {
        const id = key.replace("halo:conv:", "").replace(":messages", "");
        const c = mockConversations.get(id) || { id, messages: [] };
        c.messages.push(JSON.parse(val));
        mockConversations.set(id, c);
      }
    },
    async lpush(key, val) {
      if (key === "halo:questions") mockQuestions.unshift(JSON.parse(val));
    },
    async ltrim(_key, _start, _end) {},
    async expire() {},
    async zrange(key, start, end, opts) {
      if (key === "halo:conversations") {
        const ids = [...mockConversations.keys()];
        return opts?.rev ? ids.reverse().slice(start, end + 1) : ids.slice(start, end + 1);
      }
      return [];
    },
    async hgetall(key) {
      const id = key.replace("halo:conv:", "");
      const c = mockConversations.get(id);
      return c ? { updated_at: c.updated_at, product_title: c.product_title || "", product_url: c.product_url || "" } : null;
    },
    async lrange(key, start, end) {
      if (key === "halo:questions") return mockQuestions.slice(start, end === -1 ? undefined : end + 1).map(JSON.stringify);
      if (key.endsWith(":messages")) {
        const id = key.replace("halo:conv:", "").replace(":messages", "");
        const c = mockConversations.get(id);
        return c ? c.messages.map(JSON.stringify) : [];
      }
      return [];
    },
  };
}

function mockReply(userText) {
  const l = userText.toLowerCase();
  if (/measur|meten|meting/.test(l))
    return "Great question. Use the 3-point method: measure the width at three points (top, middle, bottom) and the height at three points (left, centre, right). Our system uses the smallest of each for a snug fit. The full measure guide is linked on this page.";
  if (/price|cost|prijs|hoeveel|expensive/.test(l))
    return "The Halo starts at €79.95 for the smallest size (20×20 cm). We add €30 per m² of window area. So a 120×150 cm window = €79.95 + (1.2 × 1.5 × €30) = about €133.95. The optional mosquito screen adds €12 per m².";
  if (/deliver|ship|when|levertijd/.test(l))
    return "Every blind is made-to-measure, so production takes 3–7 working days after you order. Shipping time on top of that depends on your country — the exact estimate shows at checkout.";
  if (/blackout|100%|light|dark/.test(l))
    return "Yes, 100% blackout. The Halo is a fully-sealed frame with dense blackout fabric — no light bleeds around the edges like it does with regular roller blinds.";
  if (/colour|color|frame|fabric|match/.test(l))
    return "Four options in both frame and fabric: Graphite (dark grey), Quartz (soft off-white), Navy, and Titanium (warm champagne). Quartz blends invisibly into white walls; Navy makes more of a statement. You can mix frame and fabric colours if you like.";
  if (/velux|skylight|roof/.test(l))
    return "The Halo is built for standard vertical windows. For angled Velux or skylight installations we don't have a dedicated solution — please email support@haloblinds.com to check your specific window.";
  if (/return|refund|warranty/.test(l))
    return "Because each blind is custom-made to your measurements, I don't want to guess about our exact return terms — please email support@haloblinds.com for those. That said, our 3-point measuring method is designed to prevent fit issues in the first place.";
  if (/hi|hello|hey|hoi|hallo/.test(l))
    return "Hey! Happy to help. What would you like to know about the Halo blinds — sizing, colours, delivery, or something else?";
  return "Good question. For anything specific about your order (stock, delivery to your country, custom sizes beyond the standard range), you can also reach us at support@haloblinds.com. Anything else about the product I can answer?";
}

// ---- Node http adapter to Web Fetch API ----
async function nodeToRequest(req) {
  const url = `http://${req.headers.host}${req.url}`;
  const method = req.method;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method, headers, body });
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) return res.end();
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// ---- Live-mode handlers (lazy import so mock mode has no deps) ----
let liveHandlers = null;
async function getLiveHandlers() {
  if (liveHandlers) return liveHandlers;
  const [chat, conversations] = await Promise.all([
    import("./api/chat.js"),
    import("./api/conversations.js"),
  ]);
  liveHandlers = { chat: chat.default, conversations: conversations.default };
  return liveHandlers;
}

// ---- Mock handlers ----
async function mockChat(request) {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  const payload = await request.json();
  const { conversation_id, messages, product_context } = payload || {};

  const userMsg = [...(messages || [])].reverse().find((m) => m.role === "user");
  const now = Date.now();
  const redis = mockRedis();
  await redis.hset(`halo:conv:${conversation_id}`, {
    updated_at: now,
    product_url: product_context?.page_url || "",
    product_title: product_context?.product_title || "Halo Total Blackout Blind",
  });
  if (userMsg) {
    await redis.rpush(`halo:conv:${conversation_id}:messages`, JSON.stringify({ role: "user", content: userMsg.content, at: now }));
    await redis.lpush("halo:questions", JSON.stringify({ q: userMsg.content, at: now, conversation_id }));
  }

  const replyText = mockReply(userMsg?.content || "");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Simulate initial delay + streaming
      await new Promise((r) => setTimeout(r, 400));
      let i = 0;
      while (i < replyText.length) {
        const step = Math.min(2 + Math.floor(Math.random() * 3), replyText.length - i);
        controller.enqueue(encoder.encode(replyText.slice(i, i + step)));
        i += step;
        await new Promise((r) => setTimeout(r, 15));
      }
      // Log reply
      await redis.rpush(`halo:conv:${conversation_id}:messages`, JSON.stringify({ role: "assistant", content: replyText, at: Date.now() }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...cors(origin),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function mockConversationsApi(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "list";
  if (action === "list") {
    const conversations = [...mockConversations.values()]
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .map((c) => ({
        id: c.id,
        updated_at: c.updated_at ? Number(c.updated_at) : null,
        product_title: c.product_title || "",
        product_url: c.product_url || "",
        message_count: c.messages.length,
        messages: c.messages,
      }));
    return Response.json({ conversations });
  }
  if (action === "questions") {
    return Response.json({ questions: mockQuestions.slice(0, 200) });
  }
  return new Response("Unknown action", { status: 400 });
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

// ---- Static file server ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(data);
  });
}

// ---- Router ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/chat") {
      const request = await nodeToRequest(req);
      const response = LIVE_MODE
        ? await (await getLiveHandlers()).chat(request)
        : await mockChat(request);
      return writeResponse(res, response);
    }
    if (url.pathname === "/api/conversations") {
      const request = await nodeToRequest(req);
      const response = LIVE_MODE
        ? await (await getLiveHandlers()).conversations(request)
        : await mockConversationsApi(request);
      return writeResponse(res, response);
    }
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard.html") {
      return serveStatic(res, path.join(__dirname, "public/dashboard.html"));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveStatic(res, path.join(__dirname, "public/index.html"));
    }
    if (url.pathname.startsWith("/public/")) {
      return serveStatic(res, path.join(__dirname, url.pathname));
    }
    res.statusCode = 404;
    res.end("Not found");
  } catch (e) {
    console.error("[dev-server]", e);
    res.statusCode = 500;
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`\n  Halo chatbot dev server`);
  console.log(`  Mode: ${LIVE_MODE ? "LIVE (real Claude + Upstash)" : "MOCK (in-memory, canned replies)"}`);
  console.log(`\n  → http://localhost:${PORT}          (test product page with chat widget)`);
  console.log(`  → http://localhost:${PORT}/dashboard (chat log dashboard)`);
  if (!LIVE_MODE) {
    console.log(`\n  Tip: set ANTHROPIC_API_KEY + KV_REST_API_* in .env.local to switch to real Claude.\n`);
  } else {
    console.log("");
  }
});
