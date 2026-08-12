/* Reference photos attached to a contact-form inquiry.

   Two jobs live here. Compression shrinks whatever the client picked — a 12MP
   phone photo is ~5MB — down to something an inbox can hold, and the mosaic
   builder turns the compressed set into the table-based HTML that renders in
   the notification email.

   Both halves are here because they share one fact: the pixel dimensions
   settled on during compression are the same dimensions the mosaic lays out
   with. Splitting them would mean measuring the images twice.

   The layout half is pure arithmetic and runs under Node for the tests; the
   compression half needs a canvas and only runs in the browser. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InquiryPhotos = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PHOTOS = 6;

  /* EmailJS caps the total size of attachment variables per plan, and the cap
     is low enough that six untouched phone photos would blow straight past it.
     The budget below is for the whole set, not per photo, so one reference
     photo arrives sharp and six arrive smaller — which is the right trade,
     since six photos are being read as a mood board rather than studied.

     Raise it if the EmailJS plan allows more; the compressor simply aims at
     whatever number it is given. */
  const MAX_TOTAL_BYTES = 750 * 1024;

  /* Email bodies are laid out at 600px by convention — wider gets clipped in
     Outlook's reading pane. Every dimension the mosaic emits is derived from
     this, and is written into the HTML as an explicit pixel value, because no
     email client can be trusted with CSS layout. */
  const EMAIL_WIDTH = 600;
  const GAP = 8;
  const TARGET_ROW_HEIGHT = 180;
  /* A trailing row is not stretched to fill the width — a lone portrait would
     become absurdly tall. It keeps its natural height up to this ceiling. */
  const LAST_ROW_MAX_HEIGHT = 340;

  /* Tried in order until one lands under the per-photo target. Quality drops
     first because it costs less than resolution: a slightly soft 1400px photo
     reads better as a reference than a crisp 700px one. */
  const COMPRESSION_STEPS = [
    { maxEdge: 1400, quality: 0.82 },
    { maxEdge: 1400, quality: 0.72 },
    { maxEdge: 1200, quality: 0.68 },
    { maxEdge: 1000, quality: 0.64 },
    { maxEdge: 850, quality: 0.6 },
    { maxEdge: 700, quality: 0.55 },
    { maxEdge: 560, quality: 0.5 }
  ];

  /* ============ LAYOUT ============ */

  /* Packs photos into rows that each fill the email width exactly, giving every
     photo in a row a common height — the justified layout a gallery uses. It
     keeps every aspect ratio intact, so a portrait, a landscape and a 4:3 sit
     together without being cropped or squashed.

     `photos` need only carry width and height. Returns rows of
     { index, width, height }, all in whole pixels. */
  function layoutMosaic(photos, options) {
    const opts = options || {};
    const containerWidth = opts.containerWidth || EMAIL_WIDTH;
    const gap = opts.gap == null ? GAP : opts.gap;
    const targetRowHeight = opts.targetRowHeight || TARGET_ROW_HEIGHT;
    const lastRowMaxHeight = opts.lastRowMaxHeight || LAST_ROW_MAX_HEIGHT;

    const rows = [];
    let current = [];

    const ratio = (p) => (p.height > 0 ? p.width / p.height : 1);
    /* Height at which this set of photos, side by side, fills the width. */
    const heightFor = (set) => {
      const available = containerWidth - gap * (set.length - 1);
      const ratioSum = set.reduce((sum, p) => sum + ratio(p), 0);
      return ratioSum > 0 ? available / ratioSum : targetRowHeight;
    };

    photos.forEach((photo, index) => {
      current.push({ photo, index });
      /* Adding this photo pushed the row down to the target height, so the row
         is as full as it should get. Anything taller has room for one more. */
      if (heightFor(current.map((e) => e.photo)) <= targetRowHeight) {
        rows.push(commitRow(current, heightFor(current.map((e) => e.photo))));
        current = [];
      }
    });

    if (current.length) {
      const natural = heightFor(current.map((e) => e.photo));
      rows.push(commitRow(current, Math.min(natural, lastRowMaxHeight)));
    }

    function commitRow(entries, height) {
      const h = Math.max(1, Math.round(height));
      const cells = entries.map((entry) => ({
        index: entry.index,
        width: Math.max(1, Math.round(h * ratio(entry.photo))),
        height: h
      }));

      /* Rounding each width independently leaves the row a pixel or two off the
         container. A full-width row is nudged back to exact so the mosaic edge
         stays flush; a short trailing row is left alone. */
      const total = cells.reduce((sum, c) => sum + c.width, 0) + gap * (cells.length - 1);
      if (Math.abs(total - containerWidth) <= cells.length + 2) {
        cells[cells.length - 1].width += containerWidth - total;
      }
      return cells;
    }

    return rows;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Renders the mosaic as nested tables with hardcoded pixel dimensions. Tables
     rather than grid or flex because Outlook renders mail through Word, which
     supports neither; explicit width/height attributes as well as CSS because
     clients that strip the style attribute still honour the attributes.

     Each photo is referenced as `cid:<name>` — the content ID EmailJS gives a
     variable attachment is its parameter name — so the photos are inline in the
     body *and* real attachments, which is what makes them saveable from the
     mail rather than just visible. */
  function buildMosaicHtml(photos, options) {
    if (!photos || !photos.length) return '';

    const opts = options || {};
    const containerWidth = opts.containerWidth || EMAIL_WIDTH;
    const gap = opts.gap == null ? GAP : opts.gap;
    const rows = layoutMosaic(photos, opts);

    /* Every width is a percentage of the mosaic, never a pixel count, so the
       whole thing scales as one unit when the surrounding template gives it
       less than the width it was laid out for — which any padding on the
       template's container does. Pixels here would leave the photos at their
       original size and open gaps between them instead. */
    const pct = (px) => `${((px / containerWidth) * 100).toFixed(4)}%`;
    const spacer = (width, bottom) =>
      `<td width="${pct(width)}" style="width:${pct(width)};font-size:0;line-height:0;` +
      `${bottom ? `padding-bottom:${bottom}px;` : ''}">&nbsp;</td>`;

    /* The heading is emitted here rather than written into the email template
       so that an inquiry with no photos produces nothing at all — no stray
       "Reference photos (0)" above an empty space. It also means the template
       needs no conditional, which EmailJS does not document support for. */
    const heading = opts.heading
      ? `<table role="presentation" width="${containerWidth}" cellpadding="0" cellspacing="0" ` +
        `border="0" style="width:100%;max-width:${containerWidth}px;"><tr>` +
        /* Matches the section headings in email-templates/, which is the only
           reason this styling is here rather than in the template. */
        `<td style="padding:26px 0 12px;font:700 11px/1.4 Helvetica,Arial,sans-serif;` +
        `letter-spacing:.18em;text-transform:uppercase;color:#9A7128;">` +
        `${escapeHtml(opts.heading)}</td></tr></table>`
      : '';

    /* One table per row rather than one table with several rows: table-layout
       fixed takes its columns from the first row, and mosaic rows hold
       different numbers of photos. */
    return heading + rows
      .map((cells, rowIndex) => {
        const isLastRow = rowIndex === rows.length - 1;
        const bottom = isLastRow ? 0 : gap;
        const used = cells.reduce((sum, c) => sum + c.width, 0) + gap * (cells.length - 1);

        const tds = [];
        cells.forEach((cell, cellIndex) => {
          const photo = photos[cell.index];
          const alt = escapeHtml(photo.alt || `Reference photo ${cell.index + 1}`);
          /* The width and height attributes are the layout for Outlook, which
             renders mail through Word and honours attributes over CSS. The
             percentage width and auto height take over everywhere else. */
          tds.push(
            `<td width="${pct(cell.width)}" style="width:${pct(cell.width)};vertical-align:top;` +
            `${bottom ? `padding-bottom:${bottom}px;` : ''}">` +
            `<img src="cid:${escapeHtml(photo.cid)}" alt="${alt}" ` +
            `width="${cell.width}" height="${cell.height}" ` +
            `style="display:block;border:0;outline:none;text-decoration:none;` +
            `width:100%;height:auto;border-radius:3px;">` +
            '</td>'
          );
          if (cellIndex < cells.length - 1) tds.push(spacer(gap, bottom));
        });

        /* A trailing row that does not fill the width needs the remainder
           claimed, or fixed layout hands it back to the photos and stretches
           them. */
        if (used < containerWidth) tds.push(spacer(containerWidth - used, bottom));

        return (
          `<table role="presentation" width="${containerWidth}" cellpadding="0" cellspacing="0" border="0" ` +
          `style="border-collapse:collapse;table-layout:fixed;width:100%;max-width:${containerWidth}px;">` +
          `<tr>${tds.join('')}</tr></table>`
        );
      })
      .join('');
  }

  /* ============ COMPRESSION ============ */

  function decode(file) {
    /* from-image applies the EXIF orientation flag, so a photo shot in portrait
       does not arrive rotated on its side. */
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
        createImageBitmap(file)
      );
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('could not decode'));
      };
      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('could not encode'))),
        'image/jpeg',
        quality
      );
    });
  }

  function render(source, maxEdge) {
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    /* The source is almost always larger than the target, and the default
       smoothing produces visible aliasing when downscaling that far. */
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    /* JPEG has no alpha, so a transparent PNG would encode its transparent
       areas as black without this. */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    return { canvas, width, height };
  }

  /* Re-encodes one photo as JPEG — universally rendered by mail clients, which
     WebP still is not — walking down the quality ladder until it fits
     `targetBytes`. Returns the smallest result it managed even if nothing got
     under target, so an unusually detailed photo still sends. */
  async function compressPhoto(file, targetBytes) {
    const source = await decode(file);
    let best = null;

    for (const step of COMPRESSION_STEPS) {
      const { canvas, width, height } = render(source, step.maxEdge);
      const blob = await toBlob(canvas, step.quality);
      if (!best || blob.size < best.blob.size) best = { blob, width, height };
      if (blob.size <= targetBytes) {
        best = { blob, width, height };
        break;
      }
    }

    if (source.close) source.close();
    return best;
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      /* EmailJS wants the bare base64 payload, not a data: URL. */
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('could not read'));
      reader.readAsDataURL(blob);
    });
  }

  /* Compresses a whole set against one shared budget and returns what the
     mailer needs: base64 content per photo, plus the dimensions the mosaic
     lays out with. Files that cannot be decoded — HEIC in a browser without a
     decoder, most often — are reported in `failed` rather than aborting the
     rest. */
  async function prepare(files, options) {
    const opts = options || {};
    const budget = opts.maxTotalBytes || MAX_TOTAL_BYTES;
    const list = Array.prototype.slice.call(files, 0, opts.maxPhotos || MAX_PHOTOS);
    if (!list.length) return { photos: [], failed: [], totalBytes: 0 };

    const share = Math.floor(budget / list.length);
    const photos = [];
    const failed = [];

    for (let i = 0; i < list.length; i++) {
      try {
        const result = await compressPhoto(list[i], share);
        photos.push({
          cid: `photo${photos.length + 1}`,
          name: `reference-${photos.length + 1}.jpg`,
          blob: result.blob,
          base64: await toBase64(result.blob),
          width: result.width,
          height: result.height,
          alt: `Reference photo ${photos.length + 1}`
        });
      } catch (err) {
        failed.push(list[i].name || 'photo');
      }
    }

    return {
      photos,
      failed,
      totalBytes: photos.reduce((sum, p) => sum + p.blob.size, 0)
    };
  }

  return {
    MAX_PHOTOS,
    MAX_TOTAL_BYTES,
    EMAIL_WIDTH,
    layoutMosaic,
    buildMosaicHtml,
    compressPhoto,
    prepare,
    escapeHtml
  };
});
