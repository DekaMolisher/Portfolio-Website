/* Sends the finished inquiry through the same EmailJS template the website's
   contact form uses, so an Instagram inquiry arrives looking identical to a
   web one. Server-side sending needs the private key — the public key in the
   website's source is not sufficient. */

const {
  EMAILJS_SERVICE_ID = 'service_md9heal',
  EMAILJS_TEMPLATE_ID = 'template_q92iudp',
  EMAILJS_PUBLIC_KEY = 'PMqRE4dUNYBK6sNon',
  EMAILJS_PRIVATE_KEY,
  INQUIRY_TO_EMAIL = 'giancarlorrv@gmail.com'
} = process.env;

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

function configured() {
  return Boolean(EMAILJS_PRIVATE_KEY);
}

/* Field names mirror the website form's template params exactly — the same
   template renders both, so a missing key would render as a blank line. */
function toTemplateParams(inquiry, instagramHandle) {
  const orDash = (value) => (value && String(value).trim()) || '—';

  return {
    first_name: orDash(inquiry.firstName),
    last_name: orDash(inquiry.lastName),
    nickname: orDash(inquiry.nickname),
    instagram: orDash(instagramHandle || inquiry.instagram),
    whatsapp: orDash(inquiry.whatsapp),
    email: orDash(inquiry.email),
    brief: orDash(inquiry.brief),
    date: orDash(inquiry.date),
    time: orDash(inquiry.time),
    to_email: INQUIRY_TO_EMAIL,
    reply_to: inquiry.email || INQUIRY_TO_EMAIL,
    /* The template renders a mosaic of the reference photos the website form
       collects. Instagram inquiries carry none, so these go out empty rather
       than absent — an undeclared variable would render as literal braces. */
    photos_html: '',
    photo_count: '0'
  };
}

async function sendInquiry(inquiry, instagramHandle) {
  if (!configured()) {
    throw new Error('EMAILJS_PRIVATE_KEY is not set — cannot send the inquiry email');
  }

  const res = await fetch(EMAILJS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: toTemplateParams(inquiry, instagramHandle)
    })
  });

  if (!res.ok) {
    throw new Error(`EmailJS send failed (${res.status}): ${await res.text()}`);
  }
}

module.exports = { sendInquiry, toTemplateParams, configured };
