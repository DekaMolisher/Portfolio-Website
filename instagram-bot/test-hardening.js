/* Boots the real server against a stubbed Meta API and checks the gates that protect it:
   admin auth, webhook signature, and the per-IP rate limit.

   Note the shape of the stub. It intercepts only calls out to Meta and delegates
   everything else to the real fetch — an earlier version replaced global.fetch wholesale,
   which meant the test's own requests were answered by its own stub and every assertion
   graded a fake 200. A test that cannot fail is worse than no test. */

process.env.IG_VERIFY_TOKEN = 'correct-horse-battery';
process.env.IG_ACCESS_TOKEN = 'stub';
process.env.IG_APP_SECRET = 'stub-secret';
process.env.PORT = process.env.PORT || '4599';

const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const href = typeof url === 'string' ? url : url.url || String(url);
  if (href.includes('graph.instagram.com') || href.includes('graph.facebook.com')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: '1', username: 'dekagrophy', data: [] })
    };
  }
  return realFetch(url, init);
};

require('./server.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const get = (p, headers = {}) => realFetch(BASE + p, { headers });

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
};

setTimeout(async () => {
  const TOKEN = 'correct-horse-battery';

  ok('admin: no token is refused', (await get('/admin/status')).status === 403);
  ok('admin: wrong token is refused', (await get('/admin/status?token=nope')).status === 403);
  /* Same length as the real one, so a length check alone would let it through and only a
     real comparison rejects it. */
  ok(
    'admin: a same-length wrong token is refused',
    (await get('/admin/status?token=correct-horse-batterX')).status === 403
  );
  ok('admin: correct token in the query works', (await get(`/admin/status?token=${TOKEN}`)).status === 200);
  ok(
    'admin: correct token in the header works, so it need not be in a URL',
    (await get('/admin/status', { 'x-admin-token': TOKEN })).status === 200
  );

  const unsigned = await realFetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: 'instagram', entry: [] })
  });
  ok('webhook: an unsigned POST is refused', unsigned.status === 403);

  /* /admin/subscribe is capped at 10 a minute. Failed auth still counts, which is the
     point — the cost of a request is paid before the token is checked. */
  let sawLimit = false;
  for (let i = 0; i < 14; i++) {
    if ((await get('/admin/subscribe?token=wrong')).status === 429) sawLimit = true;
  }
  ok('rate limit: a burst is cut off', sawLimit);
  ok(
    'rate limit: the refusal says when to come back',
    (await get('/admin/subscribe?token=wrong')).headers.get('retry-after') !== null
  );

  console.log(`\n${fail === 0 ? 'all passing' : `${fail} FAILING`}`);
  process.exit(fail === 0 ? 0 : 1);
}, 400);
