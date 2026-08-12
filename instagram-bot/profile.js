/* The webhook identifies a sender by an app-scoped numeric id. That is the
   right thing to reply to and the wrong thing to put in an inbox — a 17-digit
   number says nothing about who wrote in. This trades it for the @handle.

   Takes the graph caller rather than building its own, so the access token,
   host and API version stay defined in one place in server.js. */

function createHandleLookup(graph) {
  /* Looked up once per person. The call only happens when an inquiry is
     actually handed over, so this is less about saving requests than about not
     making the same one twice if someone writes in again later. */
  const cache = new Map();

  return async function lookupHandle(senderId) {
    if (cache.has(senderId)) return cache.get(senderId);

    try {
      const { ok, body } = await graph(`/${senderId}`, { params: { fields: 'username' } });
      if (ok && body && body.username) {
        const handle = `@${body.username}`;
        cache.set(senderId, handle);
        return handle;
      }
      console.log(`could not resolve @handle for ${senderId}: ${JSON.stringify(body)}`);
    } catch (err) {
      console.log(`could not resolve @handle for ${senderId}: ${err.message}`);
    }

    /* Deliberately not cached. A failure here is usually a missing permission,
       which will not fix itself — but it can also be a blip, and the lookup is
       rare enough that retrying it costs nothing worth saving. */
    return null;
  };
}

module.exports = { createHandleLookup };
