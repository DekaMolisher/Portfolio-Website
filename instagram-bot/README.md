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
| `rules[].keywords` | Any of these appearing anywhere in the message triggers the rule. |
| `rules[].reply` | The message sent back. `\n` is a line break. |

Notes on matching:

- Matching ignores case and accents, so `cuanto cuesta` also matches
  "¿Cuánto Cuesta?".
- Keywords match **anywhere** in the message, so `cuanto cuesta` matches
  "oye y cuanto cuesta una sesion?".
- Rules are checked **top to bottom** and the first match wins. Put your specific
  rules above the general ones.
- Prefer phrases over single words. `precio` is safer than `foto`.

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

### 4. Test it

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
