const Anthropic = require('@anthropic-ai/sdk');

const { ANTHROPIC_API_KEY } = process.env;

/* One tool, and it is terminal: the model calls it once it has enough to hand
   over, and the conversation ends. strict guarantees the arguments validate
   against the schema, so the email never renders a malformed field. */
const SUBMIT_INQUIRY = {
  name: 'submit_inquiry',
  description:
    'Send the finished booking inquiry to Deka by email. Call this once you have ' +
    'at least the person\'s name, a way to reach them (email or WhatsApp), what ' +
    'kind of session they want, and roughly when. Do not call it earlier — ask ' +
    'for what is missing instead. Call it only once per conversation.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      firstName: { type: 'string', description: 'Their first name.' },
      lastName: { type: 'string', description: 'Their last name, or an empty string if not given.' },
      nickname: { type: 'string', description: 'What they prefer to be called, or an empty string.' },
      email: { type: 'string', description: 'Their email address, or an empty string if they only gave WhatsApp.' },
      whatsapp: { type: 'string', description: 'Their WhatsApp number, or an empty string.' },
      brief: {
        type: 'string',
        description:
          'What they want, in your own words: type of session, location, vibe, ' +
          'number of people, and anything else useful. Write it in the language ' +
          'they used.'
      },
      date: { type: 'string', description: 'The date or rough timeframe they mentioned, or an empty string.' },
      time: { type: 'string', description: 'Time of day they mentioned, or an empty string.' }
    },
    required: ['firstName', 'lastName', 'nickname', 'email', 'whatsapp', 'brief', 'date', 'time'],
    additionalProperties: false
  }
};

function buildSystemPrompt(config, language) {
  const agent = config.agent || {};
  const languageName = language === 'en' ? 'English' : 'Spanish';

  return [
    "You are the assistant for Dekagrophy, the photography practice of Giancarlo (Deka) Rosete. " +
      'You are answering a direct message on the Instagram account @dekagrophy.',
    '',
    `Write in ${languageName}, because that is the language this person is writing in. ` +
      'If they switch languages, switch with them.',
    '',
    'Your job is to find out what they want photographed and how to reach them, then hand ' +
      'that over to Deka. You are not the photographer — Deka is. You are helping him ' +
      'collect the details so he can answer properly.',
    '',
    agent.businessContext ||
      'Deka shoots portraits, weddings, quinceañeras, concerts, events and brand content, ' +
        'and also does videography and graphic design. He is based in San Diego and works ' +
        'in both English and Spanish.',
    '',
    'How to talk:',
    '- This is an Instagram DM. Keep every message short — two or three sentences.',
    '- Ask for one or two things at a time. Never send a list of questions.',
    '- Be warm and direct. Do not be formal or corporate.',
    '- Do not use bullet points, headers, or markdown. Just write like a person.',
    '',
    'What you must not do:',
    '- Never quote a price, a rate, or a package cost. You do not know them. If they ask, ' +
      'say the price depends on the session and that Deka will confirm.',
    '- Never confirm or promise a date. You do not have his calendar. Say you will check with him.',
    '- Never invent details about past work, equipment, or availability.',
    '- If you do not know something, say so plainly and note that Deka will follow up.',
    '',
    'What you need before handing over: their name, a way to reach them (email is best, ' +
      'WhatsApp is fine), what kind of session they want, and roughly when. Location and ' +
      'the vibe they are after are useful too, but do not interrogate them for it.',
    '',
    'Never ask for their Instagram handle. You are already talking to them on Instagram, ' +
      'and their handle is attached to the inquiry automatically — asking for it reads as ' +
      'though you do not know who you are speaking to.',
    '',
    'Once you have those, call the submit_inquiry tool. After it succeeds, tell them Deka ' +
      'has their details and will follow up personally, and stop asking questions.',
    '',
    'If someone is clearly not enquiring about a shoot — they are just chatting, or they ' +
      'are an existing client — be friendly and brief, and do not push them through the ' +
      'questions.',
    agent.extraInstructions ? `\n${agent.extraInstructions}` : ''
  ].join('\n');
}

function createClient() {
  if (!ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

function textOf(message) {
  return (message.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function toolUseOf(message) {
  return (message.content || []).find((block) => block.type === 'tool_use') || null;
}

/* Returns { reply, inquiry, messages }. `inquiry` is non-null only on the turn
   the model decided it had enough — the caller sends the email and ends the
   conversation. `messages` is the updated history to persist. */
async function runAgent({ client, config, history, userMessage, language, onSubmit }) {
  const agent = config.agent || {};
  const messages = [...history, { role: 'user', content: userMessage }];

  const request = {
    /* Whatever this is set to must be a 5-generation or 4.6+ model — the two
       parameters below are how those models are configured, and older ones
       (Haiku 4.5, Sonnet 4.5) take a different shape. Getting it wrong is
       expensive to notice: every call 400s, and the caller's fallback quietly
       turns each one into a canned keyword reply, so the bot looks like it is
       working right up until you check why no inquiries arrive. */
    model: agent.model || 'claude-sonnet-5',
    max_tokens: 8000,
    /* Thinking stays on. With it disabled, the model can write a tool call into
       visible text instead of emitting a tool_use block — the turn would look
       fine and the inquiry email would silently never send. Low effort keeps
       replies fast and cheap without that risk. */
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: buildSystemPrompt(config, language),
    tools: [SUBMIT_INQUIRY],
    messages
  };

  const response = await client.messages.create(request);

  /* Safety classifiers can decline; content is empty or partial when they do. */
  if (response.stop_reason === 'refusal') {
    return { reply: null, inquiry: null, messages: history, refused: true };
  }

  /* Each step builds a new array rather than mutating the one already handed to
     a request, so a sent request is never altered after the fact. */
  const withAssistant = [...messages, { role: 'assistant', content: response.content }];

  const toolUse = toolUseOf(response);
  if (!toolUse) {
    return { reply: textOf(response), inquiry: null, messages: withAssistant };
  }

  /* The model has enough. Send the email, then let it write the sign-off itself
     so the wording matches the language and tone of the conversation. */
  let toolResult;
  let inquiry = null;
  try {
    await onSubmit(toolUse.input);
    inquiry = toolUse.input;
    toolResult = { type: 'tool_result', tool_use_id: toolUse.id, content: 'Sent to Deka successfully.' };
  } catch (err) {
    toolResult = {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Failed to send: ${err.message}. Apologise briefly and ask them to use the contact form at https://dekamolisher.github.io/Portfolio-Website/#/contact instead.`,
      is_error: true
    };
  }

  const withToolResult = [...withAssistant, { role: 'user', content: [toolResult] }];
  const followUp = await client.messages.create({ ...request, messages: withToolResult });

  return {
    reply: textOf(followUp),
    inquiry,
    messages: [...withToolResult, { role: 'assistant', content: followUp.content }]
  };
}

module.exports = { runAgent, buildSystemPrompt, createClient, SUBMIT_INQUIRY };
