# Halo Blinds — Product-Page AI Chatbot

A minimal, production-ready AI chatbot that lives on the Halo Blinds product page. Visitors ask questions about sizing, colours, delivery, and the product; Claude answers using the current page's product info as context. Every conversation is logged so you can see what people actually want to know.

- **Widget** — Shopify Liquid snippet, black chat bubble bottom-right.
- **Backend** — one Vercel Edge function proxying to Claude Haiku 4.5.
- **Storage** — Upstash Redis (free tier is enough for tens of thousands of conversations).
- **Dashboard** — password-protected page listing conversations + recent questions.

## Files

```
halo-blinds/chatbot/
├── halo-chatbot.liquid       ← paste into a Shopify snippet
├── api/
│   ├── chat.js               ← Vercel Edge function — chat + logging
│   └── conversations.js      ← Vercel Edge function — dashboard data (basic auth)
├── public/
│   └── dashboard.html        ← the dashboard UI
├── package.json
├── vercel.json
└── .env.example
```

## One-time setup (≈15 min)

### 1. Anthropic API key
- Go to [console.anthropic.com](https://console.anthropic.com), create an API key, save it.

### 2. Upstash Redis
- Sign up at [upstash.com](https://upstash.com/) → **Redis** → **Create Database**.
- Region: pick one close to your Vercel region (e.g. `eu-west-1`).
- Once created, on the database page copy **`UPSTASH_REDIS_REST_URL`** and **`UPSTASH_REDIS_REST_TOKEN`**.
  - In the env vars below they're called `KV_REST_API_URL` / `KV_REST_API_TOKEN` — this is the naming `@upstash/redis` auto-detects.

### 3. Deploy to Vercel
Push this `chatbot/` folder to a Git repo (GitHub is simplest), then:
- Go to [vercel.com/new](https://vercel.com/new), import the repo.
- **Root Directory**: set to `halo-blinds/chatbot` (or wherever this folder sits).
- **Framework Preset**: `Other` (Vercel will detect it fine).
- Before deploying, add these env vars (Project → Settings → Environment Variables):

  | Name | Value |
  |---|---|
  | `ANTHROPIC_API_KEY` | `sk-ant-...` |
  | `KV_REST_API_URL` | your Upstash REST URL |
  | `KV_REST_API_TOKEN` | your Upstash REST token |
  | `DASHBOARD_PASSWORD` | a strong password of your choice |
  | `ALLOWED_ORIGINS` | `https://haloblinds.com,https://www.haloblinds.com,https://your-store.myshopify.com` |

- Click **Deploy**. Note the production URL (e.g. `https://halo-chatbot.vercel.app`).

### 4. Add the widget to Shopify
- Shopify Admin → **Online Store → Themes → Edit code**.
- Under **Snippets**, click **Add a new snippet** → name it `halo-chatbot`.
- Paste the contents of `halo-chatbot.liquid` into it.
- At the top of the snippet, find this line and replace with your Vercel URL:
  ```liquid
  {%- assign api_url = 'https://YOUR-VERCEL-DEPLOY.vercel.app/api/chat' -%}
  ```
- Save. Now render the snippet on the product page: open your product template (e.g. `sections/main-product.liquid`, or the product template), and add:
  ```liquid
  {% render 'halo-chatbot' %}
  ```
  Anywhere near the bottom of the file is fine (the widget is fixed-position).

Alternatively, add a **Custom Liquid** block to the product template via the theme editor with just `{% render 'halo-chatbot' %}` inside.

### 5. Open the dashboard
- Go to `https://your-vercel-deploy.vercel.app/dashboard`.
- Log in as `admin` / `<DASHBOARD_PASSWORD>`.
- You'll see conversations + a "Top questions" tab.

## Local testing

```bash
cd halo-blinds/chatbot
npm install
cp .env.example .env.local   # fill in real values
npx vercel dev               # serves on http://localhost:3000
```

Open `http://localhost:3000/dashboard` and try posting to `/api/chat` from a test HTML page (or temporarily change `api_url` in the liquid snippet to `http://localhost:3000/api/chat` and put the snippet's HTML+CSS+JS into a standalone `.html` file).

## What the bot knows

The chatbot's context comes from two sources:

1. **System prompt** in `api/chat.js` — brand story, product overview, colours, opening directions, pricing rules, delivery, tone. Update this if the brand/pricing changes.
2. **`product_context`** sent by the Liquid widget on every request — the current product's title, type, price, URL, and shop currency. This is dynamic, so if you change the product price in Shopify, the bot's answers stay in sync automatically.

If a customer asks something outside the bot's knowledge (warranty details, shipping to a specific country, stock levels), the bot will honestly say it doesn't know and point them to email support. This is by design — see the "Style guide" in the system prompt.

## Costs (rough)

- **Claude Haiku 4.5**: $1/$5 per million input/output tokens. A typical 4-turn conversation is ~1500 input + 400 output tokens = ~$0.0035 per conversation. 1000 conversations ≈ $3.50.
- **Upstash Redis free tier**: 500K commands/month, 256MB — enough for tens of thousands of conversations.
- **Vercel free (hobby) tier**: 100GB bandwidth / month + Edge function invocations — plenty for launch.

## Customising

- **Tone / bot personality**: edit `SYSTEM_PROMPT` in `api/chat.js`.
- **Suggested question chips**: edit the `.halo-chip` buttons in `halo-chatbot.liquid`.
- **Colours / styling**: edit the `<style>` block at the top of `halo-chatbot.liquid`.
- **Model**: `api/chat.js` uses `claude-haiku-4-5` (fast + cheap). Swap to `claude-sonnet-4-6` for better reasoning at ~3× the cost.
- **Reply length**: `max_tokens: 800` in `api/chat.js` — increase for longer answers.

## Security notes

- API key never touches the browser — it lives only in the Vercel env vars.
- CORS is locked to your `ALLOWED_ORIGINS`.
- Conversations auto-expire from Redis after 90 days.
- Dashboard is Basic Auth — pick a strong password, rotate it if you share it.
- The bot is instructed never to invent warranties/refund policies. Still worth spot-checking early conversations.

## Troubleshooting

- **Bubble doesn't show up**: browser console will tell you. Most common: the snippet isn't rendered on the page, or the Liquid syntax broke because the theme file wasn't saved.
- **Bubble shows but chat fails**: check the browser Network tab for the `/api/chat` request. If CORS-blocked, add your `*.myshopify.com` URL to `ALLOWED_ORIGINS` and redeploy. If 500, check Vercel logs — probably a missing env var.
- **Dashboard says "Failed to load"**: not logged in. Reload and use `admin` / your `DASHBOARD_PASSWORD`.
- **Redis costs spiking**: unlikely on the free tier, but if it happens, the `halo:questions` list is capped at 500 entries and conversations expire after 90 days — you'd have to be way past the free tier's limits.
