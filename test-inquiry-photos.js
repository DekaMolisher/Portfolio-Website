/* Checks the mosaic maths, which is the half of inquiry-photos.js that has no
   browser in it. Run with `node test-inquiry-photos.js`.

   The compression half needs a canvas and is not covered here — what matters
   for the email is that every row fills the width exactly and no photo is ever
   distorted, and both of those are arithmetic. */
const { layoutMosaic, buildMosaicHtml, EMAIL_WIDTH } = require('./inquiry-photos');

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

const LANDSCAPE = { width: 1400, height: 933 };   // 3:2
const PORTRAIT = { width: 933, height: 1400 };    // 2:3
const SQUARE = { width: 1200, height: 1200 };
const FOURTHREE = { width: 1400, height: 1050 };
const GAP = 8;

const rowWidth = (row) => row.reduce((sum, c) => sum + c.width, 0) + GAP * (row.length - 1);
const photosOf = (...list) => list;

/* --- every full row fills the email width exactly --- */
{
  const sets = {
    'six landscapes': Array(6).fill(LANDSCAPE),
    'six portraits': Array(6).fill(PORTRAIT),
    'mixed orientations': photosOf(PORTRAIT, LANDSCAPE, SQUARE, FOURTHREE, PORTRAIT, LANDSCAPE),
    'four squares': Array(4).fill(SQUARE)
  };

  Object.keys(sets).forEach((label) => {
    const rows = layoutMosaic(sets[label]);
    const full = rows.slice(0, -1);
    const exact = full.every((row) => rowWidth(row) === EMAIL_WIDTH);
    check(`${label}: every full row is exactly ${EMAIL_WIDTH}px`, exact);
    check(`${label}: no row overflows the email width`,
      rows.every((row) => rowWidth(row) <= EMAIL_WIDTH));
  });
}

/* --- aspect ratios survive the layout --- */
{
  const rows = layoutMosaic(photosOf(PORTRAIT, LANDSCAPE, SQUARE, FOURTHREE));
  const cells = rows.flat().sort((a, b) => a.index - b.index);
  const source = photosOf(PORTRAIT, LANDSCAPE, SQUARE, FOURTHREE);

  const distorted = cells.filter((cell) => {
    const want = source[cell.index].width / source[cell.index].height;
    const got = cell.width / cell.height;
    return Math.abs(want - got) / want > 0.03;
  });
  check('no photo is stretched or squashed', distorted.length === 0);
  check('every photo is laid out exactly once', cells.length === 4);
}

/* --- photos in a row share a height, which is what makes it a mosaic --- */
{
  const rows = layoutMosaic(Array(6).fill(LANDSCAPE));
  const uniform = rows.every((row) => row.every((c) => c.height === row[0].height));
  check('photos sharing a row share a height', uniform);
  check('six landscapes wrap onto more than one row', rows.length > 1);
}

/* --- a lone portrait is not allowed to become a billboard --- */
{
  const [row] = layoutMosaic([PORTRAIT]);
  check('a single portrait is capped in height', row[0].height <= 340);
  check('a single portrait keeps its ratio', Math.abs(row[0].width / row[0].height - 2 / 3) < 0.03);
}

/* --- a single landscape still gets the full width it can use --- */
{
  const [row] = layoutMosaic([LANDSCAPE]);
  check('a single landscape is large', row[0].width >= 400);
  check('a single landscape does not overflow', row[0].width <= EMAIL_WIDTH);
}

/* --- the HTML is the table-based kind mail clients render --- */
{
  const photos = [
    { ...LANDSCAPE, cid: 'photo1' },
    { ...PORTRAIT, cid: 'photo2' }
  ];
  const html = buildMosaicHtml(photos);

  check('the mosaic is built from tables, not grid', /<table/.test(html) && !/display:\s*grid/.test(html));
  check('photos are referenced by content id', /src="cid:photo1"/.test(html) && /src="cid:photo2"/.test(html));
  check('images carry width and height attributes', /<img [^>]*width="\d+" height="\d+"/.test(html));
  check('images are block level, which kills the descender gap', /display:block/.test(html));
  /* A template with padding on its container gives the mosaic less room than it
     was laid out for. Percentage widths let the row shrink as a unit; fixed
     pixel widths would leave gaps between the photos instead. */
  check('images scale down with a narrower container', /width:100%;height:auto/.test(html));
  check('the mosaic never exceeds the email width', /max-width:600px/.test(html));
  check('columns are sized in percentages, not pixels', !/<td width="\d+"/.test(html));
  check('rows use fixed layout so the percentages are honoured', /table-layout:fixed/.test(html));
  check('every image has alt text', (html.match(/<img /g) || []).length === (html.match(/alt="/g) || []).length);
}

/* --- the columns of every row account for exactly 100% of the width --- */
{
  const sets = {
    'six landscapes': Array(6).fill(LANDSCAPE),
    'five mixed': photosOf(PORTRAIT, LANDSCAPE, SQUARE, FOURTHREE, PORTRAIT),
    'one portrait': [PORTRAIT],
    'two landscapes': Array(2).fill(LANDSCAPE)
  };

  Object.keys(sets).forEach((label) => {
    const photos = sets[label].map((p, i) => ({ ...p, cid: `photo${i + 1}` }));
    const html = buildMosaicHtml(photos);
    const tables = html.split('<table').slice(1);

    const balanced = tables.every((table) => {
      const widths = [...table.matchAll(/<td width="([\d.]+)%"/g)].map((m) => parseFloat(m[1]));
      return Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.01;
    });
    check(`${label}: every row's columns total 100%`, balanced);
  });
}

/* --- no photos means no markup at all, so the bot's emails are unchanged --- */
{
  check('an empty set renders nothing', buildMosaicHtml([]) === '');
  check('a missing set renders nothing', buildMosaicHtml(null) === '');
}

/* --- alt text is attacker-supplied only in the sense that filenames are --- */
{
  const html = buildMosaicHtml([{ ...SQUARE, cid: 'photo1', alt: 'a "quoted" <b>name</b>' }]);
  check('alt text is escaped', /&quot;quoted&quot;/.test(html) && !/<b>name<\/b>/.test(html));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
