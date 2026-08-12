# Reference photos on the inquiry email

The contact form lets someone attach up to six photos of the look they are
after. They arrive in your inbox as a mosaic inside the inquiry email, and as
real attachments you can save or copy out of it.

The code for this is already in place. **The EmailJS template has to be changed
by hand once** before the photos will show up — until you do, inquiries still
send fine, just without them.

---

## The two changes in the EmailJS dashboard

Open <https://dashboard.emailjs.com> → **Email Templates** → the inquiry
template (`template_q92iudp`).

### 1. Drop the mosaic into the body

In the **Content** tab, open the HTML source and paste this where the photos
should appear — under the brief reads well:

```html
{{{photos_html}}}
```

**Three braces, not two.** Two braces would print the mosaic's HTML as visible
text instead of rendering it. That is EmailJS's escaping rule and it is the one
thing here that is easy to get wrong.

There is also `{{photo_count}}` — a plain number, two braces — if you want a
heading like `Reference photos ({{photo_count}})`. It is `0` when there are
none.

### 2. Declare the six attachment slots

In the **Attachments** tab, add six attachments, all of type **Variable
Attachment**:

| Parameter Name | Filename |
| --- | --- |
| `photo1` | `reference-1.jpg` |
| `photo2` | `reference-2.jpg` |
| `photo3` | `reference-3.jpg` |
| `photo4` | `reference-4.jpg` |
| `photo5` | `reference-5.jpg` |
| `photo6` | `reference-6.jpg` |

The parameter name is what ties an attachment to its place in the mosaic —
EmailJS uses it as the image's content ID, and the mosaic refers to the photos
as `cid:photo1` and so on. Rename them and the photos stop appearing.

Save the template. That is the whole setup.

---

## What the mosaic does

Photos are laid out in rows that fill the width exactly, with everything in a
row sharing a height — the way a gallery arranges thumbnails. Nothing is
cropped or squashed, so portraits, landscapes and 4:3 all sit together at their
real proportions. The layout is worked out per inquiry, so one photo and six
photos both look deliberate.

It is built from tables with percentage widths, which is the only layout Outlook
renders reliably, and it scales down if your template's container is narrower
than 600px.

---

## Size

Six untouched phone photos are 25–30MB and no inbox wants that, so photos are
resized and re-encoded as JPEG in the browser before they are sent.

The budget is for **the whole set, not per photo** — one photo arrives sharp,
six share the room between them. Six typical phone photos come out around
550–600KB in total.

To change it, edit `MAX_TOTAL_BYTES` near the top of `inquiry-photos.js`:

```js
const MAX_TOTAL_BYTES = 750 * 1024;
```

Worth raising if your EmailJS plan allows more; attachment limits vary by plan
and are separate from the 50KB cap on ordinary template variables.

---

## If something goes wrong

The inquiry itself is never lost to a photo problem:

- **A photo will not decode** — HEIC straight off an iPhone sometimes will not,
  depending on the browser — it is skipped, the sender is told which one, and
  the rest go.
- **The send is rejected carrying the photos**, most likely for size, it goes
  again immediately without them. The inquiry lands, and the sender is told the
  photos did not make it and given your email address.
- **The form is not configured at all**, behaviour is exactly as before.

### If sending fails whenever there are fewer than six photos

Unused slots are left empty rather than being filled with anything. If your
EmailJS plan rejects an empty variable attachment, the symptom is distinctive:
six photos work, fewer always fail. The fix is on their side of the fence —
either make the unused slots optional in the template, or tell me and I will
have the form pad them.

---

## Checking it

```bash
node test-inquiry-photos.js
```

Covers the layout maths: that every row fills the width exactly, that no photo
is ever distorted, that the markup is the table-based kind mail clients render,
and that an inquiry with no photos produces no markup at all — which is what
keeps the Instagram bot's emails unchanged.

For the real thing, send yourself an inquiry with one photo, then another with
six. One and six are the two cases worth seeing with your own eyes.
