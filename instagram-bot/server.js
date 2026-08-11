const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { matchRule } = require('./matching');

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

/* Meta calls this once when you register the webhook URL. */
app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === IG_VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
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

app.post('/webhook', async (req, res) => {
  if (!signatureValid(req)) return res.sendStatus(403);

  /* Meta retries anything not acknowledged within a few seconds, so acknowledge
     first and do the work after. */
  res.sendStatus(200);

  const config = loadConfig();
  if (!config || config.enabled === false) return;
  if (req.body.object !== 'instagram') return;

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
  if (!message) return;

  /* Your own outgoing messages come back as webhooks. */
  if (message.is_echo) return;

  /* Reel shares, story replies, photos, stickers and voice notes all arrive with
     attachments and no meaningful text — never auto-reply to those. */
  if (message.attachments && message.attachments.length) return;

  const text = message.text;
  if (!text || !text.trim()) return;

  const senderId = event.sender && event.sender.id;
  if (!senderId) return;

  const rule = matchRule(config, text);
  if (!rule) return;

  if (onCooldown(senderId, config.cooldownHours ?? 168)) {
    console.log(`skipped ${senderId}: on cooldown`);
    return;
  }

  await sendReply(senderId, rule.reply);
  lastRepliedAt.set(senderId, Date.now());
  console.log(`replied to ${senderId} with rule "${rule.name}"`);
}

app.get('/', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`listening on ${PORT}`));
