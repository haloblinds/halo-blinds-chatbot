#!/usr/bin/env python3
"""
Local dev server (mock mode), for previewing the widget without Node.
For real Claude + persistence, deploy to Vercel or install Node and run `npm run dev`.

Run: python3 dev-server.py
Serves:
  http://localhost:4848           , mock product page with the chat widget
  http://localhost:4848/dashboard , chat log dashboard
"""
import http.server
import json
import os
import random
import re
import time
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "4848"))
ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")

# In-memory storage
CONVERSATIONS = {}   # id -> {id, updated_at, product_title, product_url, messages: [...]}
QUESTIONS = []       # newest first

CURRENCY_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£", "CAD": "C$", "AUD": "A$", "SEK": "kr", "DKK": "kr", "NOK": "kr", "CHF": "CHF"}

def fmt_price(amount, currency_code="EUR"):
    sym = CURRENCY_SYMBOLS.get(currency_code, currency_code + " ")
    # Different currency symbol placement rules
    if currency_code in ("SEK", "DKK", "NOK"):
        return f"{amount:.2f} {sym}"
    return f"{sym}{amount:.2f}"


def mock_reply(text: str, ctx: dict) -> str:
    lower = (text or "").lower()
    currency = (ctx or {}).get("currency_code", "EUR")
    base_price = float((ctx or {}).get("product_price_number", 79.95))
    rate = float((ctx or {}).get("rate_per_m2", 30))
    mosq = float((ctx or {}).get("mosquito_rate_per_m2", 12))
    base_display = (ctx or {}).get("product_price_display") or fmt_price(base_price, currency)
    dim_match = re.search(r"(\d{2,3})\s*[x×]\s*(\d{2,3})", text or "")

    if re.search(r"measur|meten|meting|hoe meet", lower):
        return "Great question. Use the 3-point method: measure the width at TOP, MIDDLE and BOTTOM, and the height at LEFT, CENTRE and RIGHT, we use the smallest of each for a perfect fit. And really important: measure to the millimetre or 1/16 inch, don't round to the nearest cm 🙂 Full guide with photos here: https://haloblinds.com/pages/measure"

    if re.search(r"price|cost|prijs|hoeveel|expensive|how much|kostet|wieviel|costo", lower):
        if dim_match:
            w_cm, h_cm = int(dim_match.group(1)), int(dim_match.group(2))
            w_m, h_m = w_cm / 100, h_cm / 100
            surcharge = w_m * h_m * rate
            total = base_price + surcharge
            mosq_extra = w_m * h_m * mosq
            return f"For a {w_cm}×{h_cm} cm window: {base_display} + ({w_m:.1f} × {h_m:.1f} × {fmt_price(rate, currency)}) = about {fmt_price(total, currency)}. Includes free worldwide shipping and taxes. The optional mosquito screen adds around {fmt_price(mosq_extra, currency)} for this size."
        return f"Our Halo starts at {base_display} for the smallest size (20×20 cm). We add {fmt_price(rate, currency)} per m² of window area, and shipping is always free, worldwide. Tell me your exact size and I'll calculate it for you."

    if re.search(r"deliver|ship|when|levertijd|verzending|versand", lower):
        return "Production takes 3-7 business days (each blind is made to your measurements), then shipping is usually another 3-7 business days. Shipping is free worldwide and taxes + duties are included. You'll get a tracking link once it ships."

    if re.search(r"blackout|100%|light|dark|licht|donker|dunkel|leak", lower):
        return "Yes, 100% blackout, that's really the whole point 🙂 The rigid frame seals against your window so no light leaks around the edges. That edge-leak is the enemy that regular curtains and roller blinds can't beat, especially for early-morning sun."

    if re.search(r"colou?r|kleur|farbe|which color|match|wall", lower):
        return "Two colours: Graphite (dark charcoal) or Quartz (soft off-white). The frame and fabric come as one, no mix-and-match. Quartz blends into white walls; Graphite adds contrast. Need a different colour? Email help@haloblinds.com and we can arrange a custom order."

    if re.search(r"\breturn\b|refund|money.back|30.day", lower):
        return "You get a 30-day try-at-home money-back guarantee, always. Plus our Free Fit Guarantee, if you measured wrong, we replace it free of charge. That covers the biggest worry most customers have."

    if re.search(r"warrant|garantie|guarantee", lower):
        return "You get a 2-year warranty on the product. And HaloBlinds is built for long-term daily use, with an expected lifespan of up to 30 years."

    if re.search(r"last|lifespan|lifetime|hoe lang|how long.*last|durability|durable|jaren mee", lower):
        return "HaloBlinds is built for long-term daily use, with an expected lifespan of up to 30 years. It also comes with a 2-year warranty."

    if re.search(r"velux|skylight|dakraam|dachfenster|\bbay\b|\btilt\b|tilt.and.turn|casement|patio|awning|sash|\barch\b|\bround\b|sliding door", lower):
        return "Yes, we work with European windows, tilt-and-turn, fixed, sliding, casement, hung, sash, bay, awning and skylights. What's the rough size of your window and which type is it exactly? Once I know I can help you prep the details to email help@haloblinds.com so we can confirm it fits."

    if re.search(r"damage|broke|broken|kapot|beschädigt", lower):
        return "If it arrives damaged, we'll replace it free, just send a photo to help@haloblinds.com and we handle it. Same for a wrong colour or wrong size arrival."

    if re.search(r"install|installatie|montage|drilling|bracket|drill|schrauben|boren", lower):
        return "Really easy, no drilling, no screws, no holes 🙂 The frame is adhesive. Takes about 5 minutes if your window is clean and measurements are right. Just a measuring tape before ordering, and a cloth to clean the frame area before you stick it on. Full guide: https://haloblinds.com/pages/installation"

    if re.search(r"direction|opening|openings|richting", lower):
        return "Three options: right-to-left, left-to-right, or top-to-bottom. Pick based on where you'll stand when opening it. Top-to-bottom is popular for windows above a desk, bed, or in kids' rooms, no dangling handle to reach."

    if re.search(r"mosquito|screen|mesh|mug|insect|fly|muck", lower):
        return f"The mosquito screen is a mesh that lives inside the same frame system, so it fits perfectly, no extra install. It adds about {fmt_price(mosq, currency)} per m² of window area. Handy if you like sleeping with the window open in summer."

    if re.search(r"nursery|baby|kids|children|kinder|slaap|toddler", lower):
        return "One of our most popular picks for nurseries and kids' rooms. It's completely cordless (child-safe), silent to operate, and delivers real 100% blackout so daytime naps actually stay dark. Top-to-bottom opening is a nice touch, no cord for little hands to grab."

    if re.search(r"bathroom|kitchen|badkamer|keuken|bad|küche|humid|moist", lower):
        return "Yes, the Halo works fine in bathrooms and kitchens. Just wipe with a damp cloth now and then and it stays clean."

    if re.search(r"care|cleaning|clean|schoonmaak|reinig|wash|pflege", lower):
        return "Really low-maintenance: dust it off or use a soft vacuum, and spot-clean with a damp cloth and mild soap if needed. No machine wash."

    if re.search(r"material|materiaal|stof|fabric|frame material|aluminium|polyester|weight|gewicht", lower):
        return "The frame is aluminium alloy and the fabric is a blackout honeycomb non-woven polyester, light (~2.5 kg per m²) but very effective at blocking light."

    if re.search(r"safe|cordless|child|veilig|sicher|cord", lower):
        return "Yes, fully cordless and child-safe, no cords or chains to grab. That's one reason parents pick us for nursery blackout."

    if re.search(r"recess|niche|reveal|depth", lower):
        return "You need at least 3 cm (1.18 in) recess depth for the standard fit. If your recess is shallower, we have an outside-frame install option, email help@haloblinds.com first and we'll help you set it up correctly."

    if re.search(r"max size|maximum|largest|biggest|too big|too large", lower):
        return "Standard maximum is 300 × 300 cm. For larger orders, please contact us at help@haloblinds.com."

    if re.search(r"review|trustpilot|junip|rating|testimonials", lower):
        return "You'll find all our real customer reviews right on the product page, scroll down to see them."

    if re.search(r"sample|swatch|monster|proben", lower):
        return "We do offer fabric samples! What's your delivery address? Once I have that I can help you fire off an email to help@haloblinds.com and we'll pop them in the post."

    if re.search(r"phone|call|telefon|bellen|number|contact", lower):
        return "We do email-only support at help@haloblinds.com, response within 12 hours on average. No phone team yet, but the email is fast!"

    if re.search(r"where|based|located|country|land|company|about you", lower):
        return "We're based in the Netherlands, with warehouses worldwide for fast delivery. All our blinds are made to order and shipped from the nearest warehouse."

    if re.search(r"affiliate|ugc|creator|influencer|promote|collab", lower):
        return "We'd love that! We have an affiliate program for creators and UGC, you can sign up here: https://affiliate.haloblinds.com/"

    if re.search(r"bulk|wholesale|trade|hotel|hospitality|large order|many", lower):
        return "For larger orders we handle everything one-on-one. Roughly how many blinds are you thinking, and what's the project? Once I have that I can help you send a quick email to help@haloblinds.com."

    if re.search(r"^(hi|hello|hey|hoi|hallo|hai|hola|bonjour|guten|good\s(morn|even))", lower):
        return "Hey! Happy to help. What would you like to know about the Halo blinds, sizing, colours, delivery, or something else?"

    return "Good question! For anything specific that I can't answer here, drop us a line at help@haloblinds.com and we'll get back within 12 hours. Anything else about the product I can help with?"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"  {self.command} {self.path}")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/conversations":
            return self.handle_conversations(parsed)
        # Serve static files
        if parsed.path in ("/", "/index.html"):
            return self._serve_file(os.path.join(PUBLIC, "index.html"), "text/html; charset=utf-8")
        if parsed.path in ("/dashboard", "/dashboard.html"):
            return self._serve_file(os.path.join(PUBLIC, "dashboard.html"), "text/html; charset=utf-8")
        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/chat":
            return self.handle_chat()
        self.send_error(404, "Not found")

    def _cors(self):
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Vary", "Origin")

    def _serve_file(self, path: str, content_type: str):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            self.send_error(404, "Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_chat(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self.send_error(400, "Bad JSON")
            return

        conv_id = payload.get("conversation_id")
        messages = payload.get("messages") or []
        ctx = payload.get("product_context") or {}

        user_msgs = [m for m in messages if m.get("role") == "user"]
        latest_user = user_msgs[-1]["content"] if user_msgs else ""
        now = int(time.time() * 1000)

        # Store
        conv = CONVERSATIONS.setdefault(conv_id, {
            "id": conv_id, "updated_at": now,
            "product_title": ctx.get("product_title", "Halo Total Blackout Blind"),
            "product_url": ctx.get("page_url", ""),
            "messages": []
        })
        conv["updated_at"] = now
        if latest_user:
            conv["messages"].append({"role": "user", "content": latest_user, "at": now})
            QUESTIONS.insert(0, {"q": latest_user, "at": now, "conversation_id": conv_id})
            del QUESTIONS[500:]

        reply = mock_reply(latest_user, ctx)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        # Simulate initial delay + streaming chunks (read-until-close, no chunked encoding)
        time.sleep(0.35)
        i = 0
        while i < len(reply):
            step = min(random.randint(2, 5), len(reply) - i)
            try:
                self.wfile.write(reply[i:i + step].encode("utf-8"))
                self.wfile.flush()
            except BrokenPipeError:
                return
            i += step
            time.sleep(0.02)

        # Store assistant reply after streaming
        conv["messages"].append({"role": "assistant", "content": reply, "at": int(time.time() * 1000)})

    def handle_conversations(self, parsed):
        # Mock mode: no auth required (real API requires Basic Auth)
        params = parse_qs(parsed.query)
        action = (params.get("action") or ["list"])[0]

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")

        if action == "list":
            data = sorted(CONVERSATIONS.values(), key=lambda c: -(c.get("updated_at") or 0))
            body = json.dumps({
                "conversations": [
                    {
                        "id": c["id"],
                        "updated_at": c.get("updated_at"),
                        "product_title": c.get("product_title", ""),
                        "product_url": c.get("product_url", ""),
                        "message_count": len(c["messages"]),
                        "messages": c["messages"],
                    } for c in data
                ]
            }).encode()
        elif action == "questions":
            body = json.dumps({"questions": QUESTIONS[:200]}).encode()
        else:
            body = b'{"error":"Unknown action"}'

        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"\n  Halo chatbot dev server (Python mock mode)")
    print(f"  → http://localhost:{PORT}           test product page with chat widget")
    print(f"  → http://localhost:{PORT}/dashboard chat log dashboard")
    print(f"\n  For real Claude responses: deploy to Vercel or install Node and run `npm run dev`\n")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
