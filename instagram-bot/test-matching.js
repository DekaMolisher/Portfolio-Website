/* Run with `npm test`. Add your own lines to SHOULD_REPLY / SHOULD_IGNORE after
   editing config.json to confirm the bot fires only where you expect. */
const config = require('./config.json');
const { matchRule, detectLanguage, pickReply } = require('./matching');

const SHOULD_REPLY = [
  ['Quiero agendar una sesión', 'booking'],
  ['¿Cuánto cuesta una sesión?', 'pricing'],
  ['¿Hay disponibilidad para una sesión?', 'availability'],
  ['cuanto vale una sesion de fotos', 'pricing'],
  ['Hola! Me interesa una sesion para mi quinceañera', 'booking'],
  ['How much for a portrait session?', 'pricing'],
  ['hey, are you available next weekend?', 'availability'],
  ['me puedes dar mas informacion porfa', 'info'],

  /* How people actually type it, rather than the tidy phrasing. */
  ['Cuando cuesta una sesion', 'pricing'],
  ['cuanto cobras por una sesion?', 'pricing'],
  ['cuanto me sale una sesion', 'pricing'],
  ['oye cual es el precio?', 'pricing'],
  ['precio?', 'pricing'],
  ['me pasas tu tarifa', 'pricing'],
  ['tienes paquetes?', 'info'],
  ['info porfa', 'info'],
  ['quiero una sesion de fotos', 'booking'],
  ['me gustaria agendar algo para el sabado', 'booking'],
  ['tienes cupo este mes?', 'availability'],
  ['Hey, whats up! Quiero saber los costos de tus servicios', 'pricing'],
  ['whats your pricing like', 'pricing'],
  ['do you have any openings next month', 'availability'],
  ['i want to book a shoot', 'booking']
];

const SHOULD_IGNORE = [
  'hola deka!! como estas',
  'jajaja que buena foto',
  'gracias por las fotos, quedaron increibles',
  'oye ya subiste las del sabado?',
  'buenas noches',
  'te mando la ubicacion',
  'ya llegue',
  'thank you so much!!',

  /* Near-misses the wider keyword list could wrongly catch. */
  'te aprecio un monton',
  'ya vi las fotos, me encantaron',
  'nos vemos al rato',
  'ando ocupado hoy',
  'que precioso quedo el edit'
];

let failures = 0;

for (const [text, expected] of SHOULD_REPLY) {
  const rule = matchRule(config, text);
  const got = rule ? rule.name : null;
  if (got !== expected) {
    console.log(`FAIL  expected "${expected}", got "${got}"  <- ${text}`);
    failures++;
  } else {
    console.log(`ok    ${expected.padEnd(13)} <- ${text}`);
  }
}

for (const text of SHOULD_IGNORE) {
  const rule = matchRule(config, text);
  if (rule) {
    console.log(`FAIL  expected no reply, got "${rule.name}"  <- ${text}`);
    failures++;
  } else {
    console.log(`ok    ${'(ignored)'.padEnd(13)} <- ${text}`);
  }
}

/* Which language each message gets answered in. The mixed cases are the point:
   detection reads the whole message, not the opening words. */
const LANGUAGE = [
  ['Hey, whats up! Quiero saber los costos de tus servicios', 'es'],
  ['Hola! How much for a session?', 'en'],
  ['Buenas, cuanto cobras por una sesion de fotos?', 'es'],
  ['Hi, im interested in booking a shoot in San Diego', 'en'],
  ['Hello, quiero agendar una sesion para mi novia porfa', 'es'],
  ['Hey! Do you shoot quinceañeras?', 'en'],
  ['whats your pricing like', 'en'],
  ['oye tienes disponibilidad este finde?', 'es']
];

console.log('');
for (const [text, expected] of LANGUAGE) {
  const got = detectLanguage(text, config.defaultLanguage);
  if (got !== expected) {
    console.log(`FAIL  expected ${expected}, got ${got}  <- ${text}`);
    failures++;
  } else {
    console.log(`ok    reply in ${got}  <- ${text}`);
  }
}

/* Every rule must be able to answer in both languages. */
for (const rule of config.rules) {
  for (const language of ['es', 'en']) {
    const reply = pickReply(rule, language, config.defaultLanguage);
    if (!reply) {
      console.log(`FAIL  rule "${rule.name}" has no ${language} reply`);
      failures++;
    }
  }
}

/* The fill-in form that follows every reply as a second message. */
{
  const { pickFollowUp } = require('./matching');

  for (const language of ['es', 'en']) {
    if (!pickFollowUp(config, null, language, config.defaultLanguage)) {
      console.log(`FAIL  no ${language} follow-up form`);
      failures++;
    }
  }

  const es = pickFollowUp(config, null, 'es', config.defaultLanguage);
  const en = pickFollowUp(config, null, 'en', config.defaultLanguage);

  if (es === en) {
    console.log('FAIL  the follow-up form is not translated');
    failures++;
  }
  /* Numbered end to end: the point of the form is that it can be filled in
     line by line, so a gap in the sequence is a broken form. */
  for (const [language, form] of [['es', es], ['en', en]]) {
    for (const n of ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣']) {
      if (!form.includes(n)) {
        console.log(`FAIL  ${language} form is missing item ${n}`);
        failures++;
      }
    }
  }

  if (pickFollowUp(config, { followUp: false }, 'es', config.defaultLanguage) !== null) {
    console.log('FAIL  a rule cannot opt out of the follow-up form');
    failures++;
  }
  if (pickFollowUp({}, null, 'es', 'es') !== null) {
    console.log('FAIL  the form is sent even when none is configured');
    failures++;
  }
  console.log('ok    follow-up form: translated, fully numbered, opt-outable');
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
