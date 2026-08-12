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

module.exports = { normalize, matchRule };
