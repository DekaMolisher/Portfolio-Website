/* Run with `npm test`. Add your own lines to SHOULD_REPLY / SHOULD_IGNORE after
   editing config.json to confirm the bot fires only where you expect. */
const config = require('./config.json');
const { matchRule } = require('./matching');

const SHOULD_REPLY = [
  ['Quiero agendar una sesión', 'booking'],
  ['¿Cuánto cuesta una sesión?', 'pricing'],
  ['¿Hay disponibilidad para una sesión?', 'availability'],
  ['cuanto vale una sesion de fotos', 'pricing'],
  ['Hola! Me interesa una sesion para mi quinceañera', 'booking'],
  ['How much for a portrait session?', 'pricing'],
  ['hey, are you available next weekend?', 'availability'],
  ['me puedes dar mas informacion porfa', 'info']
];

const SHOULD_IGNORE = [
  'hola deka!! como estas',
  'jajaja que buena foto',
  'gracias por las fotos, quedaron increibles',
  'oye ya subiste las del sabado?',
  'buenas noches',
  'te mando la ubicacion',
  'ya llegue',
  'thank you so much!!'
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

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
