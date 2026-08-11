/* Accent- and case-insensitive so "cuánto" and "cuanto" both match. */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchRule(config, text) {
  const normalized = normalize(text);

  const skip = (config.skipIfContains || []).some((phrase) =>
    normalized.includes(normalize(phrase))
  );
  if (skip) return null;

  return (
    (config.rules || []).find((rule) =>
      (rule.keywords || []).some((keyword) => normalized.includes(normalize(keyword)))
    ) || null
  );
}

module.exports = { normalize, matchRule };
