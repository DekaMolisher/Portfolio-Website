/* Accent- and case-insensitive so "cuánto" and "cuanto" both match. */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Keywords match on whole words, so "precio" fires on "precio?" and "el precio"
   but not on "te aprecio mucho". Accents are already stripped by normalize, so
   \b behaves predictably. */
const patternCache = new Map();
function keywordPattern(keyword) {
  let pattern = patternCache.get(keyword);
  if (!pattern) {
    const escaped = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`\\b${escaped}\\b`);
    patternCache.set(keyword, pattern);
  }
  return pattern;
}

function matchRule(config, text) {
  const normalized = normalize(text);

  /* The veto stays a plain substring test: it is meant to be blunt, and it has
     to catch things like "jaja" inside "jajajaja". */
  const skip = (config.skipIfContains || []).some((phrase) =>
    normalized.includes(normalize(phrase))
  );
  if (skip) return null;

  return (
    (config.rules || []).find((rule) =>
      (rule.keywords || []).some((keyword) => keywordPattern(keyword).test(normalized))
    ) || null
  );
}

/* Function words carry the signal: a greeting borrowed from the other language
   ("Hey, ... quiero saber los costos") barely moves the count, while the words
   holding the sentence together are almost never borrowed. Words that exist in
   both languages — "me", "no", "son", "a", "the" as a surname — are in neither
   list, since counting them adds noise on both sides. */
const ES_WORDS = new Set(
  ('que de la el los las un una unos unas por para con como cuanto cuando quiero ' +
   'quisiera tienes tiene hay es esta este esa ese eso y mi mis tu tus su sus te ' +
   'se en del al muy pero porque tambien gracias hola buenas dime saber costo ' +
   'costos precio precios servicios sesion sesiones fotos foto hacer necesito ' +
   'puedo puedes algo todo bien oye porfa favor disponible disponibilidad ' +
   'agendar reservar cuesta vale sale cobras interesa gustaria').split(' ')
);

const EN_WORDS = new Set(
  ('the is are was were you your yours i my mine how much many what when where ' +
   'do does did can could would should want need have has had hi hey hello ' +
   'thanks thank for with about and or but please im its dont available price ' +
   'prices session sessions photos photo shoot shooting book booking looking ' +
   'interested wondering we our they this that there here just like get some ' +
   'know take').split(' ')
);

/* Which language to answer in. Scores the whole message rather than reading the
   opening words, so a message that opens in one language and continues in
   another is answered in the one it is actually written in. */
function detectLanguage(text, defaultLanguage = 'es') {
  const words = normalize(text).split(/[^a-z0-9']+/).filter(Boolean);

  let es = 0;
  let en = 0;
  for (const word of words) {
    if (ES_WORDS.has(word)) es++;
    if (EN_WORDS.has(word)) en++;
  }

  /* Characters that only occur in Spanish, read from the raw text since
     normalize() strips them. Worth more than a single word. */
  if (/[ñáéíóú¿¡]/i.test(text)) es += 2;

  if (es > en) return 'es';
  if (en > es) return 'en';
  return defaultLanguage;
}

/* A reply may be a plain string (same text for everyone) or an object keyed by
   language. Falls back to the default language, then to whatever is defined, so
   a half-translated config still answers instead of throwing. */
function pickReply(rule, language, defaultLanguage = 'es') {
  const reply = rule.reply;
  if (typeof reply === 'string') return reply;
  if (!reply || typeof reply !== 'object') return null;
  return reply[language] || reply[defaultLanguage] || Object.values(reply)[0] || null;
}

/* The fill-in form sent as a second, separate message after the rule's reply.
   It is one form shared by every rule rather than one per rule, because the
   questions are the same whatever phrase brought them in — and a single form is
   one thing to edit rather than four. A rule opts out with "followUp": false.

   Sent separately rather than appended to the reply so it is a clean block to
   copy: selecting a message in Instagram takes the whole thing, and a form
   glued to a paragraph of prose comes with the prose. */
function pickFollowUp(config, rule, language, defaultLanguage = 'es') {
  if (rule && rule.followUp === false) return null;
  if (!config.followUp) return null;
  return pickReply({ reply: config.followUp }, language, defaultLanguage);
}

/* The whole outgoing message: the rule's reply, the fill-in form, then the
   signature — joined into one, because that is how it should land. Splitting it
   across messages was worse in practice: Instagram stacks them as separate
   bubbles, which reads as a bot firing twice rather than as one considered
   answer.

   Kept as three config keys rather than four copies of the same text, so the
   form and the signature are each edited in one place and cannot drift apart
   between rules. */
function composeMessage(config, rule, language, defaultLanguage = 'es') {
  const reply = pickReply(rule, language, defaultLanguage);
  if (!reply) return null;

  const parts = [reply];
  const form = pickFollowUp(config, rule, language, defaultLanguage);
  if (form) parts.push(form);

  const signature = config.signature
    ? pickReply({ reply: config.signature }, language, defaultLanguage)
    : null;
  if (signature) parts.push(signature);

  return parts.join('\n\n');
}

module.exports = { normalize, matchRule, detectLanguage, pickReply, pickFollowUp, composeMessage };
