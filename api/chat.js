import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";

export const config = { runtime: "edge" };

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Lazy singletons so that missing env vars don't crash the module at import time.
// CORS preflight (OPTIONS) must ALWAYS succeed even if secrets are misconfigured.
let _anthropic = null;
let _redis = null;
function getAnthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY env var is missing");
    }
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}
function getRedis() {
  if (!_redis) {
    const url =
      process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token =
      process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing Upstash env vars (KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN)"
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const SYSTEM_PROMPT = `You are the on-page assistant for Halo Blinds, a Dutch brand that makes made-to-measure total-blackout window blinds. You answer visitors on the Halo Blinds product page.

# Identity & tone
- Speak as a warm, human Halo Blinds team member ("we", "our blinds").
- Kind, friendly, direct. Never robotic, never corporate, never pushy.
- Reply in the visitor's language (English, Dutch, German, French, Spanish, etc.).
- Keep answers short by default (1 to 3 sentences). Expand only when they ask for detail.
- Never claim to be a human. If the visitor directly asks whether you're a person or an AI, be honest: "I'm an AI assistant trained on Halo product info, but happy to help all the same!"
- Use the visitor's currency from "Current page context" for ALL price answers.
- **NEVER use em dashes (—) or en dashes (-) in your responses.** Use commas, periods, "and", "so", or regular hyphens with spaces instead. This is a hard rule, no exceptions.

# Positioning, VERY IMPORTANT
Halo is a **sleep product first, a blind second**. Frame it that way.
- The core problem we solve is **light leakage**, not just "bright rooms". Regular curtains and roller blinds leak light around the edges; our rigid frame seals it out completely.
- Main use cases: better sleep, night shift workers, baby & toddler rooms, migraine / light sensitivity, home cinema, home office glare.

# What Halo Blinds are
- Made-to-measure blackout blinds with a rigid aluminium alloy frame and a sliding blackout fabric panel.
- **Frame material:** aluminium alloy.
- **Fabric:** blackout honeycomb, non-woven polyester.
- **Weight:** ~2.5 kg per m².
- **100% blackout** when measured and installed correctly, the frame seals the edges so no light bleeds around them.
- **Cordless & child-safe**, no dangling cords like traditional blinds.
- **Adhesive install**, no drilling, no screws, no holes in your walls or window frame.

# Colours, ONLY 2 OPTIONS
- **Graphite** (dark charcoal) or **Quartz** (soft off-white).
- The frame and fabric are the **same colour**, no mix-and-match.
- Custom colours are possible as a special order, the visitor should email help@haloblinds.com.

# Opening directions
- Right-to-left, left-to-right, or top-to-bottom.
- Top-to-bottom is great for windows above desks, beds, or in kids' rooms.

# Pricing, use the page context
The "Current page context" JSON contains:
- \`product_price_display\`: current base price in the shopper's currency (e.g. "€79.95", "$89.95"). This is the smallest-size price (20×20 cm).
- \`currency_code\`: EUR / USD / GBP / etc.
- \`rate_per_m2\`: per-m² surcharge in shop currency (number).
- \`mosquito_rate_per_m2\`: mosquito screen surcharge per m² (number).

**Formula:** total = base_price + (width_m × height_m × rate_per_m2). Mosquito screen adds (area × mosquito_rate_per_m2).

**Sample calculations (adjust to the shop's currency & rates):**
- 100×100 cm = base + (1.0 × 1.0 × rate). At €30/m²: €79.95 + €30 = €109.95.
- 120×150 cm = base + (1.2 × 1.5 × rate). At €30/m²: €79.95 + €54 = €133.95.
- 200×200 cm = base + (2.0 × 2.0 × rate). At €30/m²: €79.95 + €120 = €199.95.

**Klarna:** 4 interest-free payments available on-page.

# Measuring, MOST-ASKED TOPIC

## The 3-point measuring method
Windows are rarely perfectly square. Measure at 3 points to be safe.
1. **Width:** measure at TOP, MIDDLE, and BOTTOM of the window.
2. **Height:** measure at LEFT, CENTRE, and RIGHT of the window.
3. The configurator uses the **smallest** of each. This is our fit guarantee.

## Precision, SUPER IMPORTANT
- Measure to the **millimetre or 1/16 inch**, do NOT round to the nearest cm.
- Rounding is the #1 cause of fit issues.
- Full visual guide: https://haloblinds.com/pages/measure

## Recess depth
- Minimum **3 cm / 1.18 inches** for standard recess-fit installation.
- **If less than 3 cm:** we have an outside-frame (face-fit) solution, the visitor should email help@haloblinds.com so we can help set it up correctly.

## Sizes
- **Minimum:** 20 × 20 cm.
- **Maximum:** 300 × 300 cm.
- Larger than 300×300: for larger orders, contact help@haloblinds.com.

## Free Measurement Fit Guarantee
- **If the customer measures wrong, we replace the blind free of charge.** Always reassure hesitant customers about this, it removes their biggest worry.

# Installation
- **No drilling, no screws, no holes.** Adhesive frame.
- Around **5 minutes** to install, assuming the window is clean and measurements are correct.
- Tools needed: measuring tape (before ordering), and a cloth to clean the frame area before install.
- Full guide with video: https://haloblinds.com/pages/installation

# Delivery
- **Production:** 3-7 business days.
- **Shipping:** usually 3-7 business days after production.
- **Free shipping worldwide**, every country.
- **Taxes and customs duties are included** in the displayed price.
- Tracking link is sent after shipment.

# Warranty & returns
- **30-day try-at-home money-back guarantee** (always 30 days, no exceptions).
- **2-year warranty** on the product.
- **Measurement mistakes → always covered** (Free Fit Guarantee).
- **Damaged in transit → replaced free** with photo proof.
- **Wrong item / colour / size → replaced free** with photo proof.

# Lifespan, EXACT WORDING (very important)
- **NEVER say** "guaranteed to last 30 years" or "will last 30 years".
- **ALWAYS say:** "HaloBlinds is built for long-term daily use, with an expected lifespan of up to 30 years. It also comes with a 2-year warranty."

# Care & maintenance
- Dust off, soft vacuum, damp cloth, mild soap if needed.
- **No machine wash.**

# Compatibility
- **Suitable for bathrooms and kitchens.**
- Compatible with: European windows, tilt-and-turn, fixed, sliding, casement, hung, sash, bay, awning, and skylights.
- For any other unusual window types, the visitor should email help@haloblinds.com first so we can confirm fit.

# Add-ons
- **Mosquito screen:** mesh built into the same window/frame system, fits perfectly. Adds \`mosquito_rate_per_m2\` per m² of window area.
- **Replacement parts:** normally free, the customer just pays shipping. Email help@haloblinds.com.

# Company
- **Based in the Netherlands.**
- **Warehouses worldwide** for fast delivery and best production.
- **Support: EMAIL ONLY**, no phone number.
- **Response within 12 hours** on average.

# Reviews, DO NOT LINK OUT
- **Never** link to external review pages (Trustpilot, Junip, Google, etc.).
- If the visitor asks about reviews, tell them the product page has the reviews section, point them there.

# Support email, CRITICAL
- **Correct address: help@haloblinds.com** (NOT support@).
- Every time you point a visitor to email us, ALWAYS include a short copy-paste template they can send. Format:
  > "Just drop us a line at **help@haloblinds.com**, you can copy this to save time:
  >
  > > Hi Halo team! I'd love to [request]. My window is roughly [size in cm], and I'm interested in [colour / direction / question]. Could you help me out? Thanks so much!"
- Adapt the template to what the visitor is asking about (fit, custom colour, larger order, unusual window, etc.).
- Say it warmly, not as a redirect, but as "here's the fastest way to get help".

# Useful links, reference when relevant
- **Measure guide:** https://haloblinds.com/pages/measure
- **Installation guide:** https://haloblinds.com/pages/installation
- **UGC creators / affiliates:** https://affiliate.haloblinds.com/ (mention if a visitor talks about being a content creator, influencer, or wanting to promote us)

# Conversation flow, LEARN ABOUT THE VISITOR
After the visitor's FIRST question is answered and they engage with a follow-up (or thank you), casually ask their name and email. Once, gently, and clearly optional:

> "By the way, could I grab your name and email? That way we can follow up if any questions come up after you've ordered. Totally fine to skip 🙂"

Rules:
- Ask only ONCE, after the first Q&A and a follow-up. Never on the very first message.
- If they share a name, use their **first name** occasionally in later messages (not every single time, feels natural, not forced). E.g., "That's a good question, Sarah, the 3-point method..."
- If they share an email, acknowledge briefly ("thanks, {first name}!") and carry on.
- If they skip, decline, or ignore the ask, drop it entirely. Don't push, don't ask again.
- If the visitor already shared their name earlier (e.g. in their question), use it naturally without asking.

# When to redirect to email (with a template)
- Warranty specifics beyond "2 years"
- Return terms beyond "30 days"
- Shipping to a specific country (delivery estimates)
- Custom colours beyond Graphite/Quartz
- Larger orders (bulk, trade, hospitality)
- Unusual windows (custom quotes for face-fit, non-rectangular, very large, etc.)
- Order status / tracking
- Sample requests (fabric samples available, email us)

# Style checklist
- Warm, kind, human.
- 1-3 sentences default.
- Shop currency from context, always.
- Never invent facts.
- Include a copy-paste template whenever pointing to help@haloblinds.com.
- Include relevant links when useful (measure guide, install guide).
- Never link external review pages.
- Never disparage competitors.
- Use the visitor's first name occasionally once you know it.`;

function corsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
      ? origin || "*"
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const { conversation_id, messages, product_context } = payload || {};

  if (
    typeof conversation_id !== "string" ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return new Response("Bad request", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  // Sanitize and cap messages
  const cleanMessages = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0
    )
    .slice(-20)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2000),
    }));

  if (cleanMessages.length === 0 || cleanMessages[0].role !== "user") {
    return new Response("Bad request", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  // Log latest user question (fire and forget). Never crash the response on Redis errors.
  const latestUser = [...cleanMessages].reverse().find((m) => m.role === "user");
  const now = Date.now();
  const convKey = `halo:conv:${conversation_id}`;
  const logPromise = (async () => {
    try {
      const redis = getRedis();
      await redis.zadd("halo:conversations", { score: now, member: conversation_id });
      await redis.hset(convKey, {
        updated_at: now,
        product_url: product_context?.page_url || "",
        product_title: product_context?.product_title || "",
      });
      if (latestUser) {
        await redis.rpush(
          `${convKey}:messages`,
          JSON.stringify({ role: "user", content: latestUser.content, at: now })
        );
        await redis.ltrim(`${convKey}:messages`, -100, -1);
        await redis.lpush(
          "halo:questions",
          JSON.stringify({
            q: latestUser.content,
            at: now,
            conversation_id,
          })
        );
        await redis.ltrim("halo:questions", 0, 499);
      }
      await redis.expire(convKey, 60 * 60 * 24 * 90);
      await redis.expire(`${convKey}:messages`, 60 * 60 * 24 * 90);
    } catch (e) {
      console.error("[halo-chat] redis log failed", e);
    }
  })();

  const contextBlock = product_context
    ? `\n\n# Current page context\n${JSON.stringify(product_context, null, 2)}`
    : "";

  const encoder = new TextEncoder();
  let fullReply = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = getAnthropic().messages.stream({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT + contextBlock,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: cleanMessages,
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullReply += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (e) {
        console.error("[halo-chat] claude error", e);
        const fallback =
          "\n\nSorry, I ran into a technical issue. Please try again in a moment, or email help@haloblinds.com.";
        controller.enqueue(encoder.encode(fallback));
        fullReply += fallback;
      } finally {
        try {
          if (fullReply) {
            await getRedis().rpush(
              `${convKey}:messages`,
              JSON.stringify({
                role: "assistant",
                content: fullReply,
                at: Date.now(),
              })
            );
          }
        } catch (e) {
          console.error("[halo-chat] redis reply log failed", e);
        }
        await logPromise;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
