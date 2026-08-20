const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { matchRule, detectLanguage, composeMessage } = require('./matching');
const { runAgent, createClient } = require('./agent');
const { sendInquiry, configured: mailerConfigured } = require('./mailer');
const { createHandleLookup } = require('./profile');
const store = require('./store');

/* Built once on first use — a missing API key is a config problem, not a
   startup failure, since the keyword bot still works without it. */
let anthropic = null;

const {
  IG_VERIFY_TOKEN,
  IG_ACCESS_TOKEN,
  IG_APP_SECRET,
  IG_GRAPH_HOST = 'graph.instagram.com',
  IG_GRAPH_VERSION = 'v21.0',
  PORT = 3000
} = process.env;

const CONFIG_PATH = path.join(__dirname, 'config.json');

/* Re-read on every message so editing config.json (and redeploying, or editing on
   a persistent host) takes effect without a code change. Falls back to the last
   good copy if an edit leaves the file temporarily invalid. */
let cachedConfig = null;
function loadConfig() {
  try {
    cachedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('config.json unreadable, using last good copy:', err.message);
  }
  return cachedConfig;
}
loadConfig();

/* In-memory: a restart forgets who was replied to, which at worst costs one extra
   reply per person. Not worth a database. */
const lastRepliedAt = new Map();

function onCooldown(senderId, cooldownHours) {
  const previous = lastRepliedAt.get(senderId);
  if (!previous) return false;
  return Date.now() - previous < cooldownHours * 3600 * 1000;
}

async function graph(pathname, { method = 'GET', params = {} } = {}) {
  const url = new URL(`https://${IG_GRAPH_HOST}/${IG_GRAPH_VERSION}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}` }
  });

  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: res.status, ok: res.ok, body };
}

/* Turns the sender's numeric id into their @handle, so an inquiry that came in
   through Instagram names the person the way Instagram does. */
const lookupHandle = createHandleLookup(graph);

async function sendReply(recipientId, text) {
  const url = `https://${IG_GRAPH_HOST}/${IG_GRAPH_VERSION}/me/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${IG_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });

  if (!res.ok) {
    throw new Error(`Instagram send failed (${res.status}): ${await res.text()}`);
  }
}

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

/* Every request, so an empty log is unambiguous evidence that nothing reached
   the server at all — rather than something arriving and being dropped. */
app.use((req, _res, next) => {
  /* Redacted: the admin routes carry the shared token in the query string, and
     these logs are visible to anyone with dashboard access. */
  console.log(`${req.method} ${req.originalUrl.replace(/token=[^&]*/g, 'token=***')}`);
  next();
});

/* Meta calls this once when you register the webhook URL. */
app.get('/webhook', rateLimit(30), (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === IG_VERIFY_TOKEN
  ) {
    console.log('handshake OK');
    return res.status(200).send(req.query['hub.challenge']);
  }
  console.log(
    `handshake FAILED: token sent "${req.query['hub.verify_token']}" ` +
      `${IG_VERIFY_TOKEN ? 'does not match IG_VERIFY_TOKEN' : 'but IG_VERIFY_TOKEN is not set'}`
  );
  res.sendStatus(403);
});

/* Setup helpers, reachable from a browser because the free hosting tier has no
   shell. Guarded by IG_VERIFY_TOKEN, which is already a shared secret.

   Two things the plain `===` this used to be got wrong. It compared byte by byte and
   returned at the first mismatch, which leaks the token's prefix to anyone patient enough
   to measure — the same attack the webhook signature already uses timingSafeEqual to
   avoid, so the two checks now agree with each other. And it read the token only from the
   query string, which is the part of a URL that ends up in platform logs, browser history
   and Referer headers; an `x-admin-token` header is accepted first so the token need never
   appear in a URL at all. The query form still works, because it is what makes these
   routes usable from a phone. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function adminAuthed(req) {
  if (!IG_VERIFY_TOKEN) return false;
  const presented = req.get('x-admin-token') || req.query.token;
  return safeEqual(String(presented || ''), IG_VERIFY_TOKEN);
}

/* A fixed window per IP, in memory. Not a defence against a distributed attacker — it
   cannot be, on one free dyno with no shared store — but it puts a ceiling on what a
   single source can cost. That matters for two different reasons: /admin/* calls out to
   Meta's Graph API on every hit, and /webhook computes an HMAC over the body before it can
   reject anything, so both do real work for requests that never authenticate. */
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map();

function rateLimit(max) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else if (++bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'too many requests' });
    }

    /* Sweep on write rather than on a timer: the map only grows when requests arrive, so
       there is nothing to clean up on an idle server and no interval holding it awake. */
    if (rateBuckets.size > 500) {
      for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
    }
    next();
  };
}

/* Reports whether the access token works and whether this Instagram account is
   actually subscribed to the app — configuring the webhook in the dashboard
   does not do this, and without it Meta delivers nothing. */
app.get('/admin/status', rateLimit(20), async (req, res) => {
  if (!adminAuthed(req)) return res.status(403).json({ error: 'bad or missing ?token=' });

  const me = await graph('/me', { params: { fields: 'id,username' } });
  const subs = await graph('/me/subscribed_apps');

  const subscribedFields = Array.isArray(subs.body && subs.body.data)
    ? subs.body.data.flatMap((app) => app.subscribed_fields || [])
    : [];

  /* Conversation mode fails soft by design — a missing key sends the canned
     reply instead of erroring — which makes "enabled" and "actually working"
     two different things, and the difference invisible from the outside. This
     reports both so it can be told apart without reading the logs. */
  const agent = loadConfig().agent || {};
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const canEmail = mailerConfigured();

  res.json({
    env: {
      IG_ACCESS_TOKEN: IG_ACCESS_TOKEN ? 'set' : 'MISSING',
      IG_APP_SECRET: IG_APP_SECRET ? 'set' : 'MISSING',
      IG_VERIFY_TOKEN: IG_VERIFY_TOKEN ? 'set' : 'MISSING'
    },
    account: me.ok ? me.body : { error: 'token rejected', detail: me.body },
    subscribedApps: subs.body,
    subscribedToMessages: subscribedFields.includes('messages'),
    agent: {
      enabled: Boolean(agent.enabled),
      model: agent.model || 'claude-opus-5',
      ANTHROPIC_API_KEY: hasKey ? 'set' : 'MISSING',
      EMAILJS_PRIVATE_KEY: canEmail ? 'set' : 'MISSING',
      conversationsInProgress: store.size(),
      ready: Boolean(agent.enabled) && hasKey && canEmail,
      note: !agent.enabled
        ? 'Off — every match gets the canned keyword reply.'
        : !hasKey
          ? 'Enabled but ANTHROPIC_API_KEY is MISSING, so every message falls back to the canned reply. Add it in the host environment variables.'
          : !canEmail
            ? 'Replying, but EMAILJS_PRIVATE_KEY is MISSING — it will collect the details and then fail to email them to you. Add it in the host environment variables.'
            : 'Ready. A matching keyword starts a conversation; the finished inquiry is emailed to you.'
    },
    nextStep: subscribedFields.includes('messages')
      ? 'Subscribed. If DMs still do not arrive, check Instagram > Settings > Messages and story replies > Connected tools > Allow access to messages.'
      : 'NOT subscribed — open /admin/subscribe?token=... to fix.'
  });
});

/* The step with no button in the dashboard. */
app.get('/admin/subscribe', rateLimit(10), async (req, res) => {
  if (!adminAuthed(req)) return res.status(403).json({ error: 'bad or missing ?token=' });

  const result = await graph('/me/subscribed_apps', {
    method: 'POST',
    params: { subscribed_fields: 'messages' }
  });

  console.log(`admin subscribe -> ${result.status} ${JSON.stringify(result.body)}`);
  res.status(result.ok ? 200 : 400).json({
    ok: result.ok,
    response: result.body,
    nextStep: result.ok
      ? 'Now re-check /admin/status, then send yourself a test DM.'
      : 'Failed. The error above is from Meta — usually the access token lacks the messaging permission.'
  });
});

function signatureValid(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !req.rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', IG_APP_SECRET).update(req.rawBody).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/webhook', rateLimit(240), async (req, res) => {
  if (!signatureValid(req)) {
    /* Almost always IG_APP_SECRET not matching the app secret in the dashboard. */
    console.log('webhook REJECTED: bad signature — check IG_APP_SECRET');
    return res.sendStatus(403);
  }

  /* Meta retries anything not acknowledged within a few seconds, so acknowledge
     first and do the work after. */
  res.sendStatus(200);

  /* The body carries the message someone typed. People write to this account about nude
     and boudoir sessions, and the host's log retention is not ours to control or purge —
     so the shape of the event is logged, never its contents. The decision trail below
     ("skipped: on cooldown", "replied with rule X") is what these logs are for, and none
     of it needs the text. Set IG_LOG_BODIES=1 for a debugging session, never routinely. */
  if (process.env.IG_LOG_BODIES === '1') {
    console.log('webhook received (VERBOSE):', JSON.stringify(req.body));
  } else {
    const events = (req.body.entry || []).flatMap((e) => e.messaging || []);
    console.log(`webhook received: object=${req.body.object} events=${events.length}`);
  }

  const config = loadConfig();
  if (!config) return;
  if (config.enabled === false) return console.log('skipped: config disabled');
  if (req.body.object !== 'instagram') {
    return console.log(`skipped: object is "${req.body.object}", not "instagram"`);
  }

  for (const entry of req.body.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleMessage(config, event);
      } catch (err) {
        console.error('handler error:', err.message);
      }
    }
  }
});

async function handleMessage(config, event) {
  const message = event.message;
  if (!message) return console.log('skipped: event carries no message');

  /* Your own outgoing messages come back as webhooks. */
  if (message.is_echo) return console.log('skipped: echo of your own message');

  /* Reel shares, story replies, photos, stickers and voice notes all arrive with
     attachments and no meaningful text — never auto-reply to those. */
  if (message.attachments && message.attachments.length) {
    return console.log('skipped: message has an attachment (reel/photo/voice)');
  }

  const text = message.text;
  if (!text || !text.trim()) return console.log('skipped: empty text');

  const senderId = event.sender && event.sender.id;
  if (!senderId) return console.log('skipped: no sender id');

  const agentConfig = config.agent || {};
  const ttlHours = agentConfig.conversationTtlHours ?? 24;

  /* Someone already mid-conversation continues there, whatever they say next —
     the keyword gate is the entry condition, not a per-message filter. */
  const active = agentConfig.enabled ? store.get(senderId, ttlHours) : null;

  const rule = active ? null : matchRule(config, text);
  if (!active && !rule) return console.log(`no rule matched: "${text}"`);

  /* cooldownHours exists to stop the same canned reply going out twice, and a
     week is right for that. It is wrong for a conversation, which is supposed
     to be a back-and-forth: applied there it silences anyone whose conversation
     was dropped by a restart, for a week, with no way back. So conversation
     mode gets its own short gate on *starting* one — enough to blunt someone
     spamming the trigger words, not enough to lose a real client. */
  const cooldownHours = agentConfig.enabled
    ? (agentConfig.startCooldownHours ?? 1)
    : (config.cooldownHours ?? 168);

  if (!active && onCooldown(senderId, cooldownHours)) {
    console.log(`skipped ${senderId}: on cooldown ${cooldownHours}h (rule "${rule.name}")`);
    return;
  }

  const language = detectLanguage(text, config.defaultLanguage);

  if (agentConfig.enabled) {
    return handleWithAgent({ config, senderId, text, language, active, ttlHours });
  }

  const replyText = composeMessage(config, rule, language, config.defaultLanguage);
  if (!replyText) {
    return console.log(`rule "${rule.name}" has no usable reply — check config.json`);
  }

  await sendReply(senderId, replyText);
  lastRepliedAt.set(senderId, Date.now());
  console.log(`replied to ${senderId} with rule "${rule.name}" in ${language}`);
}

/* The conversational path. Falls back to the keyword reply on any failure, so a
   missing API key, a refusal, or an outage degrades to the behaviour that was
   working before rather than to silence. */
async function handleWithAgent({ config, senderId, text, language, active, ttlHours }) {
  const client = anthropic || (anthropic = createClient());
  if (!client) {
    console.log('agent enabled but ANTHROPIC_API_KEY is not set — using keyword reply');
    return keywordFallback(config, senderId, text, language);
  }

  const convo = active || store.start(senderId);
  const maxTurns = config.agent.maxTurns ?? 20;
  if (convo.turns >= maxTurns) {
    console.log(`conversation with ${senderId} hit maxTurns — handing off`);
    store.end(senderId);
    return;
  }

  let result;
  try {
    result = await runAgent({
      client,
      config,
      history: convo.messages,
      userMessage: text,
      language,
      /* Falls back to the raw id if the handle cannot be resolved — worth less
         in the inbox, but better than nothing to go on. */
      onSubmit: async (inquiry) => sendInquiry(inquiry, (await lookupHandle(senderId)) || senderId)
    });
  } catch (err) {
    console.error('agent error:', err.message);
    store.end(senderId);
    return keywordFallback(config, senderId, text, language);
  }

  if (result.refused || !result.reply) {
    console.log(`agent produced no reply for ${senderId} — using keyword reply`);
    store.end(senderId);
    return keywordFallback(config, senderId, text, language);
  }

  await sendReply(senderId, result.reply);

  if (result.inquiry) {
    store.end(senderId);
    lastRepliedAt.set(senderId, Date.now());
    console.log(`inquiry submitted for ${senderId}: ${JSON.stringify(result.inquiry)}`);
    return;
  }

  convo.messages = result.messages;
  convo.turns += 1;
  store.save(senderId, convo);
  console.log(`agent replied to ${senderId} (turn ${convo.turns}, ${language})`);
}

async function keywordFallback(config, senderId, text, language) {
  const rule = matchRule(config, text);
  if (!rule) return;
  const replyText = composeMessage(config, rule, language, config.defaultLanguage);
  if (!replyText) return;
  await sendReply(senderId, replyText);
  lastRepliedAt.set(senderId, Date.now());
  console.log(`fell back to rule "${rule.name}" for ${senderId}`);
}

app.get('/', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`listening on ${PORT}`));
