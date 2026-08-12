/* In-progress conversations, keyed by Instagram sender ID.
   Deliberately in-memory: Instagram only allows replying within 24 hours of the
   person's last message, so nothing here is worth outliving that window. A
   restart drops in-progress conversations — see recovery handling in agent.js,
   which treats a missing history as a fresh start rather than an error. */

const conversations = new Map();

function prune(ttlHours) {
  const cutoff = Date.now() - ttlHours * 3600 * 1000;
  for (const [id, convo] of conversations) {
    if (convo.lastAt < cutoff) conversations.delete(id);
  }
}

function get(senderId, ttlHours) {
  prune(ttlHours);
  return conversations.get(senderId) || null;
}

function start(senderId) {
  const convo = { messages: [], turns: 0, startedAt: Date.now(), lastAt: Date.now() };
  conversations.set(senderId, convo);
  return convo;
}

function save(senderId, convo) {
  convo.lastAt = Date.now();
  conversations.set(senderId, convo);
}

function end(senderId) {
  conversations.delete(senderId);
}

function size() {
  return conversations.size;
}

module.exports = { get, start, save, end, size };
