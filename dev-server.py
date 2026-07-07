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

    # Check "do you measure FOR me" style questions FIRST so they don't fall into the how-to-measure branch
    if re.search(r"do you measur|measure for me|measure it for us|come and measure|send someone|technician|fitter|installer|visit my home|come to my home|showroom|physical store|video call|come to us", lower):
        return "We don't offer that, no measuring visits or fitters on our side. But the 3-point method is designed to make DIY measuring foolproof, and with our Free Fit Guarantee we replace it free if you get the size wrong. So zero risk to trying it yourself."

    if re.search(r"measur|meten|meting|hoe meet", lower):
        return "3-point method: measure width at top, middle, bottom and height at left, centre, right. Smallest wins. Measure to the millimetre, no rounding is really important. And if you measure wrong, our Free Fit Guarantee covers a free replacement.\nhttps://haloblinds.com/pages/measure"

    if dim_match or re.search(r"price|cost|prijs|hoeveel|expensive|how much|kostet|wieviel|costo", lower):
        if dim_match:
            w_cm, h_cm = int(dim_match.group(1)), int(dim_match.group(2))
            w_m, h_m = w_cm / 100, h_cm / 100
            surcharge = w_m * h_m * rate
            total = base_price + surcharge
            mosq_extra = w_m * h_m * mosq
            return (f"For a {w_cm}×{h_cm} cm window it comes to about {fmt_price(total, currency)}, with free worldwide shipping and taxes included. "
                    f"One thing though, for the best fit we measure to the millimetre, not just whole cm. Even a few mm off can let light sneak in around the edges. "
                    f"Could you double-check the exact size (including any millimetres)? If it is tricky, our Free Fit Guarantee covers a free replacement anyway. "
                    f"The optional mosquito screen would add about {fmt_price(mosq_extra, currency)} for this size.")
        return f"Starts at {base_display} for the smallest size (20×20 cm), plus {fmt_price(rate, currency)} per m² on top. Free worldwide shipping and taxes are included. What size is your window? Then I can give you the exact number."

    if re.search(r"deliver|ship|when|levertijd|verzending|versand", lower):
        return "3 to 7 business days production, then usually another 3 to 7 for shipping. Free worldwide with taxes and duties included, and you get a tracking link once it ships."

    if re.search(r"blackout|100%|light|dark|licht|donker|dunkel|leak", lower):
        return "Yes, 100% blackout. The rigid frame seals against the window so no light leaks around the edges, which is the real difference vs regular curtains or roller blinds."

    if re.search(r"colou?r|kleur|farbe|which color|match|wall", lower):
        return "Two colours: Graphite (dark charcoal) or Quartz (soft off-white). The frame and fabric come as one, no mix-and-match. Quartz blends into white walls, Graphite adds contrast. Custom colours are possible on request, email help@haloblinds.com."

    if re.search(r"\breturn\b|refund|money.back|30.day", lower):
        return "30-day try-at-home money-back guarantee, always. And with our Free Fit Guarantee, if you measured wrong we replace it free of charge. Between those two, there's really no risk."

    if re.search(r"warrant|garantie|guarantee", lower):
        return "2-year warranty on the product. And HaloBlinds is built for long-term daily use, with an expected lifespan of up to 30 years."

    if re.search(r"last|lifespan|lifetime|hoe lang|how long.*last|durability|durable|jaren mee", lower):
        return "HaloBlinds is built for long-term daily use, with an expected lifespan of up to 30 years. It also comes with a 2-year warranty."

    if re.search(r"velux|skylight|dakraam|dachfenster|\bbay\b|\btilt\b|tilt.and.turn|casement|patio|awning|sash|\barch\b|\bround\b|sliding door", lower):
        return "We work with European, tilt-and-turn, fixed, sliding, casement, hung, sash, bay, awning and skylight windows. What size is your window and which type exactly? Once I know I can help you prep an email to help@haloblinds.com so we confirm the fit."

    if re.search(r"damage|broke|broken|kapot|beschädigt", lower):
        return "If it arrives damaged we replace it free of charge, just send a photo to help@haloblinds.com. Same for wrong colour or wrong size."

    if re.search(r"install|installatie|montage|drilling|bracket|drill|schrauben|boren", lower):
        return "Adhesive frame, no drilling, no screws, no holes. Takes about 5 minutes if the window is clean and your measurements are right. Just a measuring tape before ordering and a cloth to clean the frame area.\nhttps://haloblinds.com/pages/installation"

    if re.search(r"direction|opening|openings|richting", lower):
        return "Three options: right-to-left, left-to-right, or top-to-bottom. Pick based on where you'll stand when opening it. Top-to-bottom is popular for windows above a desk, bed, or in kids' rooms since there's no handle to reach up for."

    if re.search(r"mosquito|screen|mesh|mug|insect|fly|muck", lower):
        return f"The mosquito screen is a fine mesh built into the same frame, so it fits perfectly with no extra install. It adds about {fmt_price(mosq, currency)} per m² of window area, handy if you like sleeping with the window open in summer."

    if re.search(r"nursery|baby|kids|children|kinder|slaap|toddler", lower):
        return "One of our most popular picks for nurseries and kids' rooms. Completely cordless (child-safe), silent to operate, and real 100% blackout so daytime naps actually stay dark."

    if re.search(r"bathroom|kitchen|badkamer|keuken|bad|küche|humid|moist", lower):
        return "Yes, the Halo works fine in bathrooms and kitchens. Just wipe with a damp cloth every now and then and it stays clean."

    if re.search(r"care|cleaning|clean|schoonmaak|reinig|wash|pflege", lower):
        return "Really low-maintenance: dust it off, use a soft vacuum, or spot-clean with a damp cloth and mild soap if needed. No machine wash."

    if re.search(r"material|materiaal|stof|fabric|frame material|aluminium|polyester|weight|gewicht", lower):
        return "The frame is aluminium alloy and the fabric is a blackout honeycomb non-woven polyester. Around 2.5 kg per m², so it's light but very effective at blocking light."

    if re.search(r"safe|cordless|child|veilig|sicher|cord", lower):
        return "Fully cordless and child-safe, no cords or chains to grab. That's one reason parents pick us for nursery blackout."

    if re.search(r"recess|niche|reveal|depth", lower):
        return "You need at least 3 cm recess depth for the standard fit. If yours is shallower we have an outside-frame install option, email help@haloblinds.com first and we'll help you set it up correctly."

    if re.search(r"max size|maximum|largest|biggest|too big|too large", lower):
        return "Standard maximum is 300 × 300 cm. For anything larger just email help@haloblinds.com and we'll figure it out with you."

    if re.search(r"review|trustpilot|junip|rating|testimonials", lower):
        return "You'll find all our real customer reviews right here on the product page, just scroll down a bit."

    if re.search(r"sample|swatch|monster|proben", lower):
        return "We do send samples! What's your delivery address and would you like Graphite, Quartz, or both? Then I can help you email help@haloblinds.com."

    if re.search(r"phone|call|telefon|bellen|number|contact", lower):
        return "Email only at help@haloblinds.com. Response within 12 hours on average, no phone team yet but the email is fast."

    if re.search(r"where|based|located|country|land|company|about you", lower):
        return "We're based in the Netherlands and have warehouses worldwide for fast delivery. Every blind is made to order and shipped from the nearest warehouse."

    if re.search(r"affiliate|ugc|creator|influencer|promote|collab", lower):
        return "We'd love that! We run an affiliate program for creators and UGC, you can sign up here:\nhttps://affiliate.haloblinds.com/"

    if re.search(r"bulk|wholesale|trade|hotel|hospitality|large order|many", lower):
        return "For larger orders we handle everything one-on-one. Roughly how many blinds are you thinking about and what's the project? Once I know that I can help you send a quick note to help@haloblinds.com."

    if re.search(r"^(hi|hello|hey|hoi|hallo|hai|hola|bonjour|guten|good\s(morn|even))", lower):
        return "Hey! Happy to help. What would you like to know about the Halo, sizing, colours, delivery, or something else?"

    if re.search(r"do you measur|measure for me|measure it for us|come and measure|send someone|technician|fitter|installer|visit my home|come to my home|showroom|physical store|video call|come to us", lower):
        return "We don't offer that, no measuring visits or fitters on our side. But the 3-point method is designed to make DIY measuring foolproof, and with our Free Fit Guarantee we replace it free if you get the size wrong. So zero risk to trying it yourself."

    return "For anything specific I can't answer here, drop us a line at help@haloblinds.com and we'll get back within 12 hours. Anything else I can help with?"


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

        # Simulate a longer human "thinking" pause (matches widget's think delay)
        _thinking = min(3.5, 1.6 + len(latest_user or "") * 0.04)
        time.sleep(_thinking)
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
