/* Drives the agent against a stubbed model so the conversation flow, the tool
   round-trip, and the failure paths are all exercised without an API key.
   Run with `npm run test:agent`. */
const config = require('./config.json');
const { runAgent, buildSystemPrompt, SUBMIT_INQUIRY } = require('./agent');
const { toTemplateParams } = require('./mailer');
const { createHandleLookup } = require('./profile');
const store = require('./store');

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

/* Returns a client that replays the given responses in order and records every
   request it was given. */
function stubClient(responses) {
  const requests = [];
  return {
    requests,
    messages: {
      create: async (request) => {
        requests.push(request);
        const next = responses.shift();
        if (!next) throw new Error('stub client ran out of responses');
        return next;
      }
    }
  };
}

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolCall = (input) => ({
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: 'One sec.' },
    { type: 'tool_use', id: 'toolu_1', name: 'submit_inquiry', input }
  ]
});

const FULL_INQUIRY = {
  firstName: 'Ana',
  lastName: 'Reyes',
  nickname: '',
  email: 'ana@example.com',
  whatsapp: '',
  brief: 'Sesión de quinceañera al atardecer en Balboa Park',
  date: '15 de marzo',
  time: ''
};

(async () => {
  // --- the assistant asks a follow-up question
  {
    const client = stubClient([text('¡Hola! ¿Qué tipo de sesión tienes en mente?')]);
    const result = await runAgent({
      client,
      config,
      history: [],
      userMessage: 'hola, quiero una sesion',
      language: 'es',
      onSubmit: async () => {}
    });

    check('a question turn returns the reply text', /qué tipo de sesión/i.test(result.reply));
    check('a question turn submits no inquiry', result.inquiry === null);
    check('history keeps the user and assistant turns', result.messages.length === 2);
    check('the model is offered the submit tool', client.requests[0].tools[0].name === 'submit_inquiry');
    check('thinking stays enabled', client.requests[0].thinking.type === 'adaptive');
  }

  // --- the assistant has enough and hands over
  {
    const sent = [];
    const client = stubClient([
      toolCall(FULL_INQUIRY),
      text('¡Listo! Deka ya tiene tus datos y te escribe pronto.')
    ]);
    const result = await runAgent({
      client,
      config,
      history: [],
      userMessage: 'soy Ana Reyes, ana@example.com, quinceañera el 15 de marzo',
      language: 'es',
      onSubmit: async (inquiry) => sent.push(inquiry)
    });

    check('the inquiry is submitted exactly once', sent.length === 1);
    check('the submitted inquiry carries the collected fields', sent[0].email === 'ana@example.com');
    check('the caller is told an inquiry completed', result.inquiry !== null);
    check('the sign-off is written by the model', /Deka ya tiene tus datos/.test(result.reply));
    check('the tool result is fed back before the sign-off', (() => {
      const second = client.requests[1].messages;
      const last = second[second.length - 1];
      return last.role === 'user' && last.content[0].type === 'tool_result';
    })());
  }

  // --- the email fails: the person still gets an answer
  {
    const client = stubClient([
      toolCall(FULL_INQUIRY),
      text('Perdón, no pude enviarlo. ¿Puedes usar el formulario de la web?')
    ]);
    const result = await runAgent({
      client,
      config,
      history: [],
      userMessage: 'ahí van mis datos',
      language: 'es',
      onSubmit: async () => {
        throw new Error('EmailJS send failed (403)');
      }
    });

    check('a failed send still replies to the person', Boolean(result.reply));
    check('a failed send reports no inquiry', result.inquiry === null);
    check('the failure is passed to the model as a tool error', (() => {
      const second = client.requests[1].messages;
      return second[second.length - 1].content[0].is_error === true;
    })());
  }

  // --- a safety refusal
  {
    const client = stubClient([{ stop_reason: 'refusal', content: [] }]);
    const result = await runAgent({
      client,
      config,
      history: [],
      userMessage: 'something declined',
      language: 'en',
      onSubmit: async () => {}
    });
    check('a refusal is reported rather than sent as an empty reply', result.refused === true && result.reply === null);
  }

  // --- language reaches the system prompt
  check('an english conversation is told to answer in english', /in English/.test(buildSystemPrompt(config, 'en')));
  check('a spanish conversation is told to answer in spanish', /in Spanish/.test(buildSystemPrompt(config, 'es')));
  check('the prompt forbids quoting prices', /Never quote a price/.test(buildSystemPrompt(config, 'es')));
  check('the prompt forbids asking for the instagram handle',
    /Never ask for their Instagram handle/.test(buildSystemPrompt(config, 'es')));

  /* --- the sender's @handle is captured rather than asked for --- */
  {
    const lookup = createHandleLookup(async (pathname, opts) => {
      check('the handle lookup asks for the username field', opts.params.fields === 'username');
      check('the handle lookup addresses the sender by id', pathname === '/17841400000000000');
      return { ok: true, body: { username: 'ana.reyes' } };
    });
    check('the sender id is traded for an @handle',
      (await lookup('17841400000000000')) === '@ana.reyes');

    let calls = 0;
    const counting = createHandleLookup(async () => {
      calls++;
      return { ok: true, body: { username: 'ana' } };
    });
    await counting('user-1');
    await counting('user-1');
    check('a resolved handle is looked up only once', calls === 1);

    const denied = createHandleLookup(async () => ({ ok: false, body: { error: 'no permission' } }));
    check('a refused lookup reports no handle', (await denied('user-2')) === null);

    const broken = createHandleLookup(async () => { throw new Error('network down'); });
    check('a failed lookup does not throw', (await broken('user-3')) === null);

    let retries = 0;
    const flaky = createHandleLookup(async () => {
      retries++;
      return retries === 1 ? { ok: false, body: {} } : { ok: true, body: { username: 'ana' } };
    });
    await flaky('user-4');
    check('a failed lookup is retried rather than cached', (await flaky('user-4')) === '@ana');

    check('the handle is what reaches the email',
      toTemplateParams(FULL_INQUIRY, '@ana.reyes').instagram === '@ana.reyes');
  }

  // --- the tool schema is strict, so arguments always validate
  check('the submit tool is strict', SUBMIT_INQUIRY.strict === true);
  check('the submit tool rejects unknown fields', SUBMIT_INQUIRY.input_schema.additionalProperties === false);

  // --- the email maps onto the website template's fields
  {
    const params = toTemplateParams(FULL_INQUIRY, '17841400000000000');
    check('email carries the first name', params.first_name === 'Ana');
    check('email carries the brief', /quinceañera/.test(params.brief));
    check('blank optional fields render as a dash', params.whatsapp === '—' && params.time === '—');
    check('reply-to is the client, not the inbox', params.reply_to === 'ana@example.com');
    check('the photo mosaic is empty rather than missing',
      params.photos_html === '' && params.photo_count === '0');
  }

  // --- conversations expire rather than accumulating
  {
    const convo = store.start('user-ttl');
    check('a started conversation is retrievable', store.get('user-ttl', 24) !== null);

    /* Age it by two minutes rather than using a zero TTL, which would race the
       millisecond clock. */
    convo.lastAt = Date.now() - 2 * 60 * 1000;
    check('a conversation inside the window survives', store.get('user-ttl', 24) !== null);
    check('an expired conversation is dropped', store.get('user-ttl', 1 / 60) === null);
  }

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
