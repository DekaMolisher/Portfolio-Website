# Instagram DM auto-reply for @dekagrophy

Listens for DMs to @dekagrophy and replies **only** when a message matches one of
your inquiry keywords. Everything else — casual chats with models, shared reels,
story replies, photos, voice notes — is ignored.

Runs on a free cloud host, so your computer does not need to be on.

---

## How it decides whether to reply

A message gets an auto-reply only if **all** of these are true:

1. The bot is enabled (`"enabled": true` in `config.json`).
2. It is a plain text message — anything with an attachment (reel share, story
   reply, photo, sticker, voice note) is skipped.
3. It is not an echo of a message you sent yourself.
4. It contains **none** of the `skipIfContains` phrases.
5. It contains at least one keyword from a rule.
6. That sender has not already had an auto-reply within `cooldownHours`.

Because rule 5 is an allowlist, silence is the default. A normal conversation
never triggers the bot — you have to actively add the phrases that should.

---

## Editing your keywords and templates

Everything you will want to change lives in **`config.json`**. No code.

```json
{
  "enabled": true,
  "cooldownHours": 168,
  "skipIfContains": ["jajaja", "gracias"],
  "rules": [
    {
      "name": "pricing",
      "keywords": ["cuanto cuesta", "how much"],
      "reply": "Your message here.\n\nLine breaks use \\n."
    }
  ]
}
```

| Field | What it does |
| --- | --- |
| `enabled` | Set to `false` to switch the whole bot off without undeploying. |
| `cooldownHours` | How long before the same person can get another auto-reply. `168` = one week. |
| `skipIfContains` | A hard veto. If a message contains any of these, it is never replied to — even if it also matches a keyword. |
| `rules[].name` | A label for your own reference and the logs. |
| `rules[].keywords` | Any of these appearing as whole words in the message triggers the rule. |
| `rules[].reply` | The message sent back, as `{"es": "...", "en": "..."}`. `\n` is a line break. |
| `followUp` | The fill-in form appended to every reply. `null` switches it off. |
| `signature` | The last line of every message. `null` for none. |
| `defaultLanguage` | Used only when a message is too short or too mixed to call. |

### What a reply actually looks like

Three config keys are joined into **one** message — the rule's `reply`, then
`followUp`, then `signature`:

```
¡Hola! Gracias por escribir 🙌

Los precios dependen del tipo de sesión, la duración y cuántas
fotos editadas quieras — por eso Deka necesita un par de datos.

━━━━━━━━━━━━━━━━━━━━━━
📋 CUÉNTAME DE TU SESIÓN
━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Nombre:
2️⃣ Tipo de sesión:
3️⃣ Fecha tentativa:
…

— Deka's Assistant
```

The form is one block for all four rules, and the signature one line for all
four, so neither can drift apart between them — edit each in a single place. To
skip the form for one rule, add `"followUp": false` to it.

Note the voice: the messages speak **about** Deka in the third person, because
they are signed by his assistant. If you change the signature back to a personal
one, switch the replies to first person to match.

### Which language a reply is sent in

Every rule carries a Spanish and an English version, and the language is chosen
per message:

```json
"reply": {
  "es": "¡Hola! Los precios dependen…",
  "en": "Hey! Pricing depends…"
}
```

The **whole message** is scored, not its opening words, because people switch
languages mid-sentence. "Hey, whats up! Quiero saber los costos de tus
servicios" opens in English but is written in Spanish, and is answered in
Spanish. Scoring counts the small function words — *que, los, para, tus* against
*the, your, how, much* — since those are rarely borrowed, and Spanish-only
characters (ñ, á, ¿) count too. When nothing separates them, `defaultLanguage`
decides.

A reply may still be a plain string instead of an object, in which case everyone
gets the same text.

Notes on matching:

- Matching ignores case and accents, so `cuanto cuesta` also matches
  "¿Cuánto Cuesta?".
- Keywords match anywhere in the message but only as **whole words**, so
  `precio` fires on "cual es el precio?" and not on "te aprecio mucho".
  Punctuation does not get in the way — `precio` still matches "precio?".
- Rules are checked **top to bottom** and the first match wins. Put your specific
  rules above the general ones.
- Because matching is word-aware, single words like `precio` or `agendar` are
  safe to use. Still avoid words that turn up in ordinary conversation — `foto`
  would fire on "mándame la foto".
- `skipIfContains` works differently on purpose: it is a plain substring test, so
  `jaja` also catches "jajajaja".

### Check your edits before they go live

```bash
npm test
```

This runs your real `config.json` against a list of sample messages and prints
what each one would do. Add your own lines to `SHOULD_REPLY` and `SHOULD_IGNORE`
in `test-matching.js` — especially real messages from your regulars that must
never get an auto-reply.

```bash
npm run test:webhook
```

Boots the server against a stubbed Instagram API and checks the whole path:
signature rejection, cooldown, echoes, reel shares.

---

## Conversation mode

Instead of one canned reply, a matching keyword starts a real exchange: the
assistant asks what they need, collects the details over a few messages, and
then emails you **the same template the website's contact form sends** — so an
Instagram inquiry lands in your inbox looking identical to a web one.

It is switched on in `config.json`:

```json
"agent": { "enabled": true, "model": "claude-opus-5", "maxTurns": 20 }
```

**Being enabled is not the same as working.** Two environment variables have to
exist on the host, and without them it silently sends the canned replies
instead:

| Key | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com> → API keys |
| `EMAILJS_PRIVATE_KEY` | EmailJS dashboard → Account → API keys → Private Key |

On Render: **Dashboard → your service → Environment → Add Environment
Variable**, then let it redeploy.

The public EmailJS key in the website's source cannot send from a server; the
private key is what authorises it. It belongs in the host's environment
variables, never in `config.json`.

### Check it is actually running

```
https://your-service.onrender.com/admin/status?token=YOUR_IG_VERIFY_TOKEN
```

The `agent` block in the response answers the question directly:

```json
"agent": {
  "enabled": true,
  "ANTHROPIC_API_KEY": "set",
  "EMAILJS_PRIVATE_KEY": "set",
  "conversationsInProgress": 0,
  "ready": true,
  "note": "Ready. A matching keyword starts a conversation…"
}
```

`ready` is the one to read. If it is `false`, `note` says which of the two keys
is missing and what happens meanwhile. This exists because the failure is
designed to be invisible from the outside — someone messaging you still gets a
sensible reply, just the canned one.

### What stays the same

**The keyword list is still the entry condition.** A conversation only starts if
a message matches a rule, so ordinary chats with your regulars are untouched —
the anti-spam behaviour is unchanged. Once a conversation *is* running, every
following message from that person goes to the assistant until it finishes,
expires, or hits `maxTurns`.

**`cooldownHours` does not apply.** A week between replies is right for a canned
message and wrong for a conversation, which is meant to be a back-and-forth.
Worse, applied here it would silence anyone whose conversation was lost to a
restart — for a week, with no way back. Conversation mode uses
`agent.startCooldownHours` (default `1`) instead, and only as the gate on
*starting* a new conversation.

### Who wrote in

The webhook identifies people by a 17-digit app-scoped id, which tells you
nothing. Before the inquiry is emailed, that id is traded for the sender's
**@handle** through the profile API, so an Instagram inquiry names them the way
Instagram does — and the assistant is told never to ask for it, because asking
someone their handle mid-DM reads as though you do not know who you are talking
to.

It needs the same `instagram_business_manage_messages` permission the bot
already uses to reply. If the lookup is refused the raw id is sent instead and
the reason is logged; the inquiry still arrives.

### What it will and won't say

The assistant is instructed never to quote a price, never to confirm a date, and
never to invent details — it says Deka will confirm. Edit `businessContext` to
correct what it knows about your services, and `extraInstructions` to add rules
of your own. Both live in `config.json`.

### Limits worth knowing

- **Conversations live in memory.** The free hosting tier restarts periodically,
  and a restart drops anything in progress — the next message from that person
  simply starts over. Nothing breaks; they just repeat themselves once.
- **24-hour window.** Instagram only allows replying within 24 hours of the
  person's last message, so a conversation someone abandons cannot be revived.
- **Cost.** A completed conversation runs around 5–8 cents on `claude-sonnet-5`.
  `claude-opus-5` is roughly triple that and buys little here — the job is
  asking four questions and filling in a form.
- **Don't drop below Sonnet.** Haiku 4.5 is cheaper again, but it is a
  4.5-generation model and `thinking: {type: "adaptive"}` and `output_config`
  in `agent.js` are how 4.6-and-later models are configured. Point the agent at
  an older one and every request fails, which the fallback turns into canned
  keyword replies — so it keeps answering people and simply stops collecting
  anything. Saving three cents a conversation is not worth a failure that looks
  like success.
- **Every failure falls back.** A missing API key, a refusal, or an outage sends
  the plain keyword reply instead — never silence.

Check the behaviour with `npm run test:agent`, which drives the whole flow
(question turns, the hand-over, a failed email, a refusal) against a stubbed
model, so it needs no API key and costs nothing.

## One-time setup

### 1. Instagram side

1. Your account must be a **Business** or **Creator** account
   (Instagram app → Settings → Account type).
2. Go to <https://developers.facebook.com> → **My Apps** → **Create App** →
   choose **Business**.
3. Add the **Instagram** product, then open **Instagram → API setup with
   Instagram login**. Use this panel, *not* "API setup with Facebook login" —
   they are different flows and mixing them causes errors.
4. Under **Generate access tokens**, click **Add an Instagram Account**, log in
   as @dekagrophy, then click **Generate token**. Collect:
   - **Instagram access token** → `IG_ACCESS_TOKEN`
   - **App secret** (App settings → Basic) → `IG_APP_SECRET`
5. Invent any random string for `IG_VERIFY_TOKEN` — you will paste the same
   value in two places in step 3.

#### If you see "Insufficient Developer Role"

While the app is in Development mode, only accounts with a role on the app can
authorize it. The login popup silently reuses whatever Instagram session the
browser already has, so this is usually the wrong account rather than a broken
app. Try in this order:

1. **Wrong account in the browser.** Open a private window, log into
   `instagram.com` as @dekagrophy specifically, then retry from the dashboard.
2. **No role on the app.** App Dashboard → **App roles → Roles → Add People** →
   **Instagram Tester** → `dekagrophy`. Then, as @dekagrophy, go to
   **instagram.com → Edit Profile → Apps and Websites → Tester Invites** and
   **accept** it. The invite does nothing until accepted.
3. **Account is still Personal.** It must be Business or Creator.

### 2. Deploy to Render

1. Push this repo to GitHub (already done if you are reading this there).
2. <https://render.com> → **New** → **Web Service** → connect the repo.
3. Settings:
   - **Root Directory**: `instagram-bot`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Add the environment variables:

   | Key | Value |
   | --- | --- |
   | `IG_VERIFY_TOKEN` | your random string |
   | `IG_ACCESS_TOKEN` | from step 1 |
   | `IG_APP_SECRET` | from step 1 |

   These three live only in Render's environment variables — never in
   `config.json`, never in a committed file, never pasted into a chat or an
   issue. If a secret is exposed, reset it immediately at **App settings →
   Basic → App secret → Reset**; the app secret is what proves a webhook
   really came from Meta, so anyone holding it can forge requests to your
   endpoint.
   | `IG_APP_SECRET` | from step 1 |

5. Deploy, then copy the service URL, e.g. `https://dekagrophy-bot.onrender.com`.

> Render's free tier sleeps after ~15 minutes idle and takes a few seconds to
> wake. A webhook that arrives while it is asleep can be missed. If you want
> guaranteed delivery, use Render's paid tier or Railway (~$5/month).

### 3. Point Instagram at it

1. In your Meta app → **Instagram** → **Webhooks** → **Edit subscription**.
2. **Callback URL**: `https://your-service.onrender.com/webhook`
3. **Verify Token**: the same `IG_VERIFY_TOKEN` string.
4. Click **Verify and Save** — it should succeed immediately.
5. Subscribe to the **`messages`** field.

### 4. Subscribe the account to the app

**Do not skip this — it is the step with no button in the dashboard.**

Configuring the webhook tells Meta that the *app* can receive message events. It
does not subscribe your *account* to them. That requires a `POST` to
`/me/subscribed_apps`, and without it Meta delivers nothing at all: no error, no
retry, and a completely silent log that is indistinguishable from a broken
server.

Visit, in a browser:

```
https://your-service.onrender.com/admin/status?token=YOUR_IG_VERIFY_TOKEN
```

That reports which credentials are set, whether Meta accepts the access token,
which account it resolves to, and `subscribedToMessages`. If that last one is
`false`:

```
https://your-service.onrender.com/admin/subscribe?token=YOUR_IG_VERIFY_TOKEN
```

Then re-check `/admin/status` and confirm it flipped to `true`.

Both routes are guarded by `IG_VERIFY_TOKEN`, and the request log redacts it.
They only read status and subscribe — they cannot send messages or change the
config.

### 5. Check the account-side toggle

In the Instagram app, as the business account:
**Settings → Messages and story replies → Connected tools → Allow access to
messages** must be ON. It is off by default and silently blocks delivery
regardless of everything else.

### 6. Test it

DM @dekagrophy from another account with "cuanto cuesta una sesion". You should
get the pricing template back within a second or two. Then send "hola" from a
third account and confirm nothing happens.

Render's **Logs** tab shows a line for every decision:

```
replied to 17841... with rule "pricing"
skipped 17841...: on cooldown
```

---

## Changing the templates later

Edit `config.json`, run `npm test`, then commit and push. Render redeploys
automatically within a minute. Nothing else to touch.

---

## Limits worth knowing

- **You cannot DM someone first.** Instagram only allows replying to people who
  messaged you, and only within 24 hours of their message. This bot always
  replies immediately, so that window is never a problem — but it does mean the
  contact form cannot trigger a DM to someone who has not written to you.
- **Text only.** The Instagram API can send images and link buttons, but those
  need extra app permissions. The templates include your contact-form URL as
  plain text, which Instagram renders as a tappable link.
- **App Review.** Meta apps start in Development mode, where messaging works
  only for accounts with a role on the app. To reply to the public, submit for
  App Review with the `instagram_business_manage_messages` permission.
