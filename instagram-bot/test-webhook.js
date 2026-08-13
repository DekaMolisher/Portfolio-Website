/* Boots the real server against a stubbed Instagram API and drives the webhook
   end to end. Run with `npm run test:webhook`. */
const crypto = require('crypto');

process.env.IG_VERIFY_TOKEN = 'test-verify';
process.env.IG_APP_SECRET = 'test-secret';
process.env.IG_ACCESS_TOKEN = 'test-token';
process.env.PORT = '3999';

const BASE = 'http://127.0.0.1:3999';

/* Intercept only outbound calls to Instagram; the test's own calls to the local
   server pass through to the real fetch. */
const realFetch = global.fetch;
const sent = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).includes('instagram.com')) {
    /* Sends carry a body; the profile and subscription lookups are GETs, so
       they are answered rather than recorded. */
    if (opts.body) sent.push(JSON.parse(opts.body));
    const body = String(url).includes('/me/subscribed_apps')
      ? { data: [{ subscribed_fields: ['messages'] }] }
      : { id: '17841400000000000', username: 'dekagrophy' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }
  return realFetch(url, opts);
};

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

function sign(body) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', 'test-secret').update(Buffer.from(body)).digest('hex')
  );
}

function event(text, extra = {}, senderId = 'user-1') {
  return JSON.stringify({
    object: 'instagram',
    entry: [{ messaging: [{ sender: { id: senderId }, message: { text, ...extra } }] }]
  });
}

async function post(body, { signed = true } = {}) {
  const res = await realFetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signed ? { 'X-Hub-Signature-256': sign(body) } : {})
    },
    body
  });
  /* The handler acknowledges before doing the work, so let it finish. */
  await new Promise((r) => setTimeout(r, 40));
  return res;
}

(async () => {
  require('./server.js');
  await new Promise((r) => setTimeout(r, 400));

  const good = await realFetch(
    `${BASE}/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=abc123`
  );
  check('verify handshake returns the challenge', (await good.text()) === 'abc123');

  const bad = await realFetch(
    `${BASE}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`
  );
  check('verify handshake rejects a wrong token', bad.status === 403);

  sent.length = 0;
  const unsigned = await post(event('cuanto cuesta una sesion'), { signed: false });
  check('unsigned webhook rejected', unsigned.status === 403);
  check('unsigned webhook sends nothing', sent.length === 0);

  sent.length = 0;
  await post(event('¿Cuánto cuesta una sesión?'));
  check('inquiry triggers the reply and the form', sent.length === 2);
  check('reply uses the pricing template', /precios dependen/i.test(sent[0]?.message?.text || ''));
  check('reply is addressed to the sender', sent[0]?.recipient?.id === 'user-1');
  /* Its own message, not appended: selecting a message in Instagram takes the
     whole thing, so a form glued to the reply cannot be copied on its own. */
  check('the form is a separate second message', /cópiame esta lista/i.test(sent[1]?.message?.text || ''));
  check('the form is numbered end to end', /1️⃣[\s\S]*7️⃣/.test(sent[1]?.message?.text || ''));
  check('the form goes to the same person', sent[1]?.recipient?.id === 'user-1');

  sent.length = 0;
  await post(event('cuanto cuesta', {}, 'user-1'));
  check('same sender on cooldown gets nothing', sent.length === 0);

  sent.length = 0;
  await post(event('Hi! How much for a session?', {}, 'user-en'));
  check('english inquiry gets the english reply', /Pricing depends/i.test(sent[0]?.message?.text || ''));
  check('the form follows the same language', /copy this list/i.test(sent[1]?.message?.text || ''));

  sent.length = 0;
  await post(event('Hey, whats up! Quiero saber los costos', {}, 'user-mixed'));
  check(
    'mixed message answered in its majority language',
    /precios dependen/i.test(sent[0]?.message?.text || '')
  );

  sent.length = 0;
  await post(event('hola deka! como estas', {}, 'user-2'));
  check('casual message ignored', sent.length === 0);

  sent.length = 0;
  await post(event('gracias! y cuanto cuesta?', {}, 'user-5'));
  check('skipIfContains wins over a keyword', sent.length === 0);

  sent.length = 0;
  await post(event('cuanto cuesta una sesion', { is_echo: true }, 'user-3'));
  check('your own echoed message ignored', sent.length === 0);

  sent.length = 0;
  await post(event('cuanto cuesta', { attachments: [{ type: 'ig_reel' }] }, 'user-4'));
  check('shared reel ignored', sent.length === 0);

  for (const route of ['/admin/status', '/admin/subscribe']) {
    const noToken = await realFetch(`${BASE}${route}`);
    check(`${route} rejects a missing token`, noToken.status === 403);

    const wrongToken = await realFetch(`${BASE}${route}?token=nope`);
    check(`${route} rejects a wrong token`, wrongToken.status === 403);
  }

  /* Conversation mode fails soft, so "enabled" and "working" can differ without
     any outward sign. These tests run with no ANTHROPIC_API_KEY, which is the
     exact state of a host where the variable was never added — the status route
     has to name that rather than just report enabled. */
  {
    const status = await realFetch(`${BASE}/admin/status?token=test-verify`).then((r) => r.json());
    check('/admin/status reports whether the agent is on', typeof status.agent.enabled === 'boolean');
    check('/admin/status flags the missing API key', status.agent.ANTHROPIC_API_KEY === 'MISSING');
    check('/admin/status does not claim to be ready without it', status.agent.ready === false);
    /* Matches whichever reason applies — off, or on with a key missing — since
       the flag is meant to be flipped and the test should not pin it. Either
       way the note has to say that canned replies are what goes out. */
    check('/admin/status explains what that means',
      /canned/i.test(status.agent.note));
    check('/admin/status still reports the Instagram side',
      status.subscribedToMessages === true);
  }

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
