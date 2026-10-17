// A very small PDF writer.
//
// HEAT needs to hand somebody a sheet of paper, so it has to produce a real PDF
// file in the browser, on a phone, with no server involved. Every library that
// does this is at least a third of a megabyte, and the repo installs with a
// frozen lockfile, so adding one is not a one-line change either. A print sheet
// only needs text, rules, boxes and one photograph, and that is small enough to
// write out by hand — which is what this file is.
//
// What it gives you: US Letter pages, three weights of one typeface, text that
// wraps on real letter widths, filled and stroked rectangles, and a JPEG dropped
// in without re-encoding. What it does not give you: tables, columns, links,
// anything non-Latin. See `transliterate` below for how accents are handled.
//
// Everything here is pure. It takes data and returns bytes, so it can be tested
// with `pnpm test` and knows nothing about React, the browser or Supabase.
// The sheets themselves — what actually goes on the paper — are in `sheets.ts`.

const W_REGULAR = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,
  556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,
  0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,
  278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,552,
  400,549,333,333,333,576,537,333,333,333,365,556,834,834,834,611,
  667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
  556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,
  556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500
];
const W_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,
  556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,
  0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,
  278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,552,
  400,549,333,333,333,576,556,333,333,333,365,556,834,834,834,611,
  722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
  556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,
  611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556
];
/* ---------------------------------------------------------------- metrics -- */

/**
 * Four faces, because weight and slant are now the whole vocabulary.
 *
 * Every level on a card is set at the same size, so nothing is marked by being
 * bigger: a section is opened in bold oblique, a thing is named in bold, the
 * thing itself is said in regular, and anything that is an aside leans. Three
 * unambiguous signals and one combination reserved for the top of them.
 */
export type Weight = "regular" | "bold" | "oblique" | "boldOblique";

/** The order they are written into each file, and what the page calls them. */
const FACES = ["regular", "bold", "oblique", "boldOblique"] as const;
const FACE_NAME: Record<Weight, string> = {
  regular: "F1",
  bold: "F2",
  oblique: "F3",
  boldOblique: "F4",
};

// Helvetica's oblique is the roman slanted rather than a drawn italic, so it has
// the roman's widths exactly — and the bold oblique the bold's. One table each,
// used twice, and `measure` stays right for all four.
const WIDTHS: Record<Weight, number[]> = {
  regular: W_REGULAR,
  bold: W_BOLD,
  oblique: W_REGULAR,
  boldOblique: W_BOLD,
};

// The 14 typefaces every PDF reader is required to have built in, so nothing
// has to be embedded. These are metric-compatible with the tables above.
const BASE_FONT: Record<Weight, string> = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  oblique: "Helvetica-Oblique",
  boldOblique: "Helvetica-BoldOblique",
};

// WinAnsi covers Latin-1 plus the curly quotes and dashes, which is enough for
// Spanish, French and Italian. It has no macrons, so romanised Japanese — shoyu,
// ponzu, Tokyo — would come out blank. Rather than drop those letters we fold
// them to the nearest plain one, and fold the typographic characters a phone
// keyboard inserts on its own.
const FOLD: Record<string, string> = {
  "Ā": "A", "ā": "a", "Ē": "E", "ē": "e",
  "Ī": "I", "ī": "i", "Ō": "O", "ō": "o",
  "Ū": "U", "ū": "u", "̄": "",
  "Œ": "\u008c", "œ": "\u009c",
  "‘": "\u0091", "’": "\u0092", "“": "\u0093", "”": "\u0094",
  "–": "\u0096", "—": "\u0097", "…": "\u0085", "•": "\u0095",
  "′": "'", "″": '"', " ": " ", "​": "",
  "−": "-", "­": "", "⁄": "/", "€": "\u0080",
  "Š": "\u008a", "š": "\u009a", "Ž": "\u008e", "ž": "\u009e",
  "™": "\u0099", "‰": "\u0089", "‹": "\u008b", "›": "\u009b",
};

/** Fold a string into something WinAnsi can represent. Unknown letters drop. */
export function transliterate(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const folded = FOLD[ch];
    if (folded !== undefined) { out += folded; continue; }
    const code = ch.codePointAt(0) ?? 32;
    if (code === 10 || code === 9) { out += ch; continue; }
    if (code >= 32 && code <= 255) { out += ch; continue; }
    // Last resort: strip the accent and try again (e.g. "ǎ" -> "a").
    const bare = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (bare !== ch && bare.length === 1) {
      const c = bare.codePointAt(0) ?? 0;
      if (c >= 32 && c <= 255) { out += bare; continue; }
    }
  }
  return out;
}

/** Width of a string in points. */
export function measure(text: string, weight: Weight, size: number): number {
  const table = WIDTHS[weight];
  let total = 0;
  const s = transliterate(text);
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 32 || code > 255) continue;
    total += table[code - 32] || 0;
  }
  return (total * size) / 1000;
}

/**
 * Break text into lines that fit `width`. Respects newlines the author typed,
 * which matters for a cocktail spec — one ingredient per line is the whole point
 * of that field.
 */
export function wrap(text: string, weight: Weight, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of transliterate(text).split("\n")) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, weight, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      // A single word too long for the line (a URL, a long hyphenless name)
      // has to be cut, or it would run off the edge of the paper.
      if (measure(word, weight, size) <= width) { line = word; continue; }
      let piece = "";
      for (const ch of word) {
        if (measure(piece + ch, weight, size) > width && piece) { lines.push(piece); piece = ""; }
        piece += ch;
      }
      line = piece;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/* ---------------------------------------------------------------- jpeg ----- */

export type Jpeg = { bytes: Uint8Array; width: number; height: number; gray: boolean };

/**
 * Read the size and colour model straight out of a JPEG's frame header. PDF can
 * carry JPEG data untouched (the DCTDecode filter is the JPEG decoder), so the
 * photograph on a dish card is embedded byte for byte — no re-encoding, no
 * quality lost, and the file stays small.
 */
export function readJpeg(bytes: Uint8Array): Jpeg | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // Any SOF except SOF4/SOF12 (which are not image frames) carries the size.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (!width || !height) return null;
      return { bytes, width, height, gray: components === 1 };
    }
    if (length <= 0) return null;
    i += 2 + length;
  }
  return null;
}

/* ---------------------------------------------------------------- writer --- */

const ASCII = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Escape a string for a PDF literal, and send anything above ASCII as octal. */
function pdfString(text: string): string {
  let out = "(";
  const s = transliterate(text);
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code === 10) out += "\\n";
    else if (code === 9) out += " ";
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `${out})`;
}

/**
 * A string for the document's own metadata, which is not page text.
 *
 * Page text is drawn in a WinAnsi-encoded font, so `pdfString` folds to WinAnsi
 * code points. A string in the Info dictionary is read as PDFDocEncoding
 * instead, and the two tables disagree above 127: an em dash written as WinAnsi
 * 0x97 is Scaron in PDFDocEncoding, which is why every sheet used to be called
 * "Something S-caron card" in a viewer's title bar. UTF-16BE behind a byte-order
 * mark is the one spelling both agree on, and it needs no transliteration —
 * a macron survives here even though it cannot survive on the page.
 */
function pdfTextString(text: string): string {
  let out = "FEFF";
  for (let i = 0; i < text.length; i += 1) {
    out += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${out}>`;
}

const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();

/** A gray (0 black, 1 white) or an RGB colour, each channel 0 to 1. */
export type Ink = number | readonly [number, number, number];
const fillInk = (ink: Ink): string =>
  typeof ink === "number" ? `${n2(ink)} g` : `${n2(ink[0])} ${n2(ink[1])} ${n2(ink[2])} rg`;
const strokeInk = (ink: Ink): string =>
  typeof ink === "number" ? `${n2(ink)} G` : `${n2(ink[0])} ${n2(ink[1])} ${n2(ink[2])} RG`;

type Obj = { body: string; stream?: Uint8Array };

/**
 * A PDF under construction. Pages are content streams of drawing operators;
 * `build` wires them to a catalogue, a font for each weight, any images, and the
 * cross-reference table the format needs at the end.
 */
export class Pdf {
  readonly width: number;
  readonly height: number;
  private pages: string[] = [];
  private current = "";
  private images: Jpeg[] = [];
  private usedImages = new Set<number>();

  constructor(width = 612, height = 792) {
    this.width = width;
    this.height = height;
  }

  /* --- drawing. y is measured down from the top of the page, like a screen. */

  text(
    value: string,
    x: number,
    y: number,
    weight: Weight,
    size: number,
    gray: Ink = 0,
    tracking = 0,
  ): void {
    if (!value) return;
    const f = FACE_NAME[weight];
    this.current +=
      `BT ${gray ? `${fillInk(gray)} ` : ""}${tracking ? `${n2(tracking)} Tc ` : ""}/${f} ${n2(size)} Tf ` +
      `1 0 0 1 ${n2(x)} ${n2(this.height - y)} Tm ${pdfString(value)} Tj ET\n` +
      (tracking ? "0 Tc\n" : "") +
      (gray ? "0 g\n" : "");
  }

  fill(x: number, y: number, w: number, h: number, gray: Ink): void {
    this.current += `${fillInk(gray)} ${n2(x)} ${n2(this.height - y - h)} ${n2(w)} ${n2(h)} re f 0 g\n`;
  }

  stroke(x: number, y: number, w: number, h: number, gray: Ink = 0.75, lineWidth = 0.7): void {
    this.current +=
      `${strokeInk(gray)} ${n2(lineWidth)} w ${n2(x)} ${n2(this.height - y - h)} ${n2(w)} ${n2(h)} re S 0 G\n`;
  }

  image(jpeg: Jpeg, x: number, y: number, w: number, h: number): void {
    let index = this.images.indexOf(jpeg);
    if (index < 0) { this.images.push(jpeg); index = this.images.length - 1; }
    this.usedImages.add(index);
    this.current +=
      `q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.height - y - h)} cm /Im${index + 1} Do Q\n`;
  }

  newPage(): void {
    this.pages.push(this.current);
    this.current = "";
  }

  /**
   * Draw onto a page that is already finished. A footer has to say "1 of 4", and
   * the 4 is only known once the last page exists, so the footers are added at
   * the end by coming back to each page in turn.
   */
  appendToPage(index: number, render: () => void): void {
    const live = this.current;
    this.current = index < this.pages.length ? this.pages[index] : live;
    render();
    if (index < this.pages.length) {
      this.pages[index] = this.current;
      this.current = live;
    }
  }

  get pageCount(): number {
    return this.pages.length + 1;
  }

  /**
   * Run a block, keep whatever it measured, throw away the ink.
   *
   * One thing on a sheet has to be sized against something drawn beside it: a
   * photograph wants to be about as tall as the words next to it, and the only
   * way to know how tall those words come out is to set them. So they are set
   * once onto a page that is then rolled back — including any page break and any
   * image they registered on the way — and set again for real afterwards.
   */
  trial(render: () => void): void {
    const live = this.current;
    const pages = this.pages.length;
    const images = this.images.length;
    render();
    this.pages.length = pages;
    this.images.length = images;
    this.current = live;
  }

  build(title: string): Uint8Array {
    const pages = [...this.pages, this.current];
    const objects: Obj[] = [];
    const add = (body: string, stream?: Uint8Array): number => {
      objects.push({ body, stream });
      return objects.length; // object numbers are 1-based
    };

    const catalog = add(""); // filled in once the page tree number is known
    const tree = add("");
    const fonts = FACES.map((weight) =>
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONT[weight]} /Encoding /WinAnsiEncoding >>`),
    );
    const imageRefs = this.images.map((jpeg) =>
      add(
        `<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} ` +
          `/ColorSpace /Device${jpeg.gray ? "Gray" : "RGB"} /BitsPerComponent 8 ` +
          `/Filter /DCTDecode /Length ${jpeg.bytes.length} >>`,
        jpeg.bytes,
      ),
    );

    const xobject = imageRefs.length
      ? ` /XObject << ${imageRefs.map((ref, i) => `/Im${i + 1} ${ref} 0 R`).join(" ")} >>`
      : "";
    const fontDict = FACES.map((weight, i) => `/${FACE_NAME[weight]} ${fonts[i]} 0 R`).join(" ");
    const resources = `<< /Font << ${fontDict} >>${xobject} >>`;

    const pageRefs: number[] = [];
    for (const content of pages) {
      const stream = ASCII(content);
      const contentRef = add(`<< /Length ${stream.length} >>`, stream);
      pageRefs.push(
        add(
          `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${n2(this.width)} ${n2(this.height)}] ` +
            `/Resources ${resources} /Contents ${contentRef} 0 R >>`,
        ),
      );
    }

    objects[catalog - 1].body = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
    objects[tree - 1].body =
      `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] >>`;
    const info = add(
      `<< /Title ${pdfTextString(title)} /Producer (HEAT) /Creator (HEAT) >>`,
    );

    /* --- serialise, tracking the byte offset of every object for the xref. */

    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (part: Uint8Array | string): void => {
      const bytes = typeof part === "string" ? ASCII(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };

    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    const offsets: number[] = [];
    objects.forEach((obj, i) => {
      offsets[i] = length;
      push(`${i + 1} 0 obj\n${obj.body}\n`);
      if (obj.stream) {
        push("stream\n");
        push(obj.stream);
        push("\nendstream\n");
      }
      push("endobj\n");
    });

    const xref = length;
    let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) table += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    push(table);
    push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\n` +
        `startxref\n${xref}\n%%EOF\n`,
    );

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }
}

/* ---------------------------------------------------------------- sheet ---- */

/**
 * The house style for a printed HEAT sheet: margins, a type scale, a header with
 * the restaurant's name, and a footer carrying both dates and a page count.
 *
 * `Sheet` keeps a cursor running down the page and starts a new page when a block
 * would not fit, so the sheets in `sheets.ts` read as a list of things to put on
 * the paper rather than a pile of coordinates.
 *
 * Paper is not a screen, so colour does no work here beyond the photograph: the
 * status a coloured chip carries on a phone is spelled out in words instead, and
 * everything else is black on white so it survives a back-office laser printer
 * and a photocopy of a photocopy.
 */

export type SheetHeader = {
  /** The restaurant, top left on every page. */
  restaurant: string;
  /** What this sheet is: "Dish card", "Quiz", "Standard". */
  kind: string;
  /** When the content itself last changed, already formatted. Blank if unknown. */
  updated?: string;
  /** Today, already formatted. */
  printed: string;
};

// A card is meant to be one sheet of paper. These sizes are a step down from a
// screen's: on paper you are holding it, not reading it at arm's length, and a
// dish that spills onto a second page gets stapled, dropped, or half-read.
const MARGIN = 46;
const SIZE = {
  eyebrow: 7,
  h1: 17,
  h2: 10.5,
  body: 9.5,
  small: 8,
  foot: 7,
};
// Prose wants room to breathe. A list does not: it is read downwards, a line at a
// time, and the same leading that helps a paragraph pulls a list of four short
// items apart into four unrelated things.
const LEAD = { body: 12, list: 11.5, small: 10.5 };
/**
 * A heading belongs to what is underneath it.
 *
 * It used to have the same air above as below, which left it floating between two
 * blocks rather than opening one, and it is most of what made a card look loose.
 * The space above is now a little under twice the space below. The hairline that
 * used to sit under every heading is gone with it: a bold, dark, letter-spaced
 * line of capitals is already a heading, and five rules on a card this size are
 * five lines of furniture. The two heavy rules around the allergens stay — they
 * are not decoration, they are what makes somebody stop.
 */
const SPACE = { aboveSection: 12.5, belowSection: 6.5 };
// `soft` is for text that should stay out of the way (the kicker, the footer).
// `label` is for a heading: it is bold already, but bold is invisible at 7pt in pale
// grey, so what makes it read as a heading is darker ink, not more weight.
const GRAY = { rule: 0.78, soft: 0.42, label: 0.2, mid: 0.3 };

export class Sheet {
  readonly pdf: Pdf;
  /**
   * The margin follows the paper. A dish card is half the size of a letter, and
   * a letter's margins on it would leave a column too narrow to set a sentence in.
   */
  private readonly margin: number;
  private y: number;
  /** How far the text column is currently inset on each side. A box pushes its
   *  contents in on both; a photograph beside the text pushes only the left. */
  private insetLeft = 0;
  private insetRight = 0;
  private readonly bottom: number;
  private readonly header: SheetHeader;

  constructor(header: SheetHeader, pdf = new Pdf()) {
    this.pdf = pdf;
    this.header = header;
    this.margin = pdf.width < 500 ? 30 : MARGIN;
    this.y = this.margin;
    this.bottom = pdf.height - this.margin - 22;
    this.drawHeader();
  }

  /** Left edge of the text column. */
  get left(): number {
    return this.margin + this.insetLeft;
  }

  /** Right edge of the page's text area. Page furniture ignores the inset. */
  get right(): number {
    return this.pdf.width - this.margin;
  }

  get width(): number {
    return this.pdf.width - 2 * this.margin - this.insetLeft - this.insetRight;
  }

  /* --- page furniture */

  private drawHeader(): void {
    const { restaurant, kind } = this.header;
    const left = this.margin;
    this.y = this.margin;
    this.pdf.text("HEAT", left, this.y + 8, "bold", SIZE.eyebrow, 0, 0.6);
    const label = kind.toUpperCase();
    this.pdf.text(
      label,
      this.right - measure(label, "regular", SIZE.eyebrow) - 1.6 * label.length,
      this.y + 8,
      "regular",
      SIZE.eyebrow,
      GRAY.soft,
      1.6,
    );
    this.pdf.text(restaurant, left + 34, this.y + 8, "regular", SIZE.eyebrow, GRAY.soft, 0.6);
    this.y += 14;
    this.pdf.fill(left, this.y, this.right - left, 0.9, GRAY.mid);
    this.y += 24;
  }

  private drawFooter(page: number, total: number): void {
    const { printed, updated } = this.header;
    const y = this.pdf.height - this.margin + 4;
    this.pdf.fill(this.margin, y - 12, this.right - this.margin, 0.5, GRAY.rule);
    const dates = updated
      ? `Printed ${printed}  \u00b7  Content last updated ${updated}`
      : `Printed ${printed}`;
    this.pdf.text(dates, this.margin, y, "regular", SIZE.foot, GRAY.soft);
    if (total > 1) {
      const stamp = `${page} of ${total}`;
      this.pdf.text(
        stamp,
        this.right - measure(stamp, "regular", SIZE.foot),
        y,
        "regular",
        SIZE.foot,
        GRAY.soft,
      );
    }
  }

  /** Start a new page, carrying the header over. Footers are added at the end. */
  nextPage(): void {
    this.pdf.newPage();
    this.drawHeader();
  }

  /** Make sure `height` points are available, breaking the page if not. */
  need(height: number): void {
    if (this.y + height > this.bottom) this.nextPage();
  }

  get cursor(): number {
    return this.y;
  }

  gap(points: number): void {
    this.y += points;
  }

  /* --- blocks */

  eyebrow(value: string): void {
    if (!value) return;
    this.need(14);
    this.pdf.text(value.toUpperCase(), this.left, this.y + 6, "regular", SIZE.eyebrow, GRAY.soft, 0.6);
    this.y += 11;
  }

  h1(value: string): void {
    const lines = wrap(value, "bold", SIZE.h1, this.width);
    this.need(lines.length * (SIZE.h1 + 3) + 4);
    for (const line of lines) {
      this.pdf.text(line, this.left, this.y + SIZE.h1, "bold", SIZE.h1);
      this.y += SIZE.h1 + 3;
    }
    this.y += 4;
  }

  h2(value: string): void {
    this.need(SIZE.h2 + 16);
    this.pdf.text(value, this.left, this.y + SIZE.h2, "bold", SIZE.h2);
    this.y += SIZE.h2 + 8;
  }

  /**
   * The line that opens a block. Set at the same size as everything else and in
   * the one face nothing else uses, so it is the top of the hierarchy without
   * being bigger, in capitals, or spaced out. See SPACE for why it has no rule.
   */
  section(value: string): void {
    this.need(SPACE.aboveSection + SIZE.body + SPACE.belowSection + LEAD.body);
    this.y += SPACE.aboveSection;
    this.pdf.text(value, this.left, this.y + SIZE.body, "boldOblique", SIZE.body);
    this.y += SIZE.body + SPACE.belowSection;
  }

  body(value: string, options: { weight?: Weight; size?: number; gray?: number; indent?: number } = {}): void {
    if (!value) return;
    const weight = options.weight ?? "regular";
    const size = options.size ?? SIZE.body;
    const indent = options.indent ?? 0;
    const lead = size <= SIZE.small ? LEAD.small : LEAD.body;
    for (const line of wrap(value, weight, size, this.width - indent)) {
      this.need(lead);
      this.pdf.text(line, this.left + indent, this.y + size, weight, size, options.gray ?? 0);
      this.y += lead;
    }
  }

  /**
   * A paragraph where a short label before a colon is set in bold:
   *
   *     Salsa gyutan: balsamic sauce, tonkatsu sauce, smoked oil.
   *
   * A sauce breakdown typed as flat text reads as a wall, and the names are
   * exactly what somebody is scanning for. Nothing in the database marks them as
   * names — they are a line in a free-text description — so they are found by
   * shape: a short run of text, no full stop in it, followed by a colon. Anything
   * that does not fit that shape is left as ordinary text, so an ordinary
   * sentence that happens to contain a colon is never mangled.
   */
  labelledBody(value: string, options: { size?: number; gray?: number } = {}): void {
    if (!value) return;
    const size = options.size ?? SIZE.body;
    const lead = size <= SIZE.small ? LEAD.small : LEAD.body;
    for (const paragraph of value.split("\n")) {
      const line = paragraph.trim();
      if (!line) {
        this.y += lead;
        continue;
      }
      const match = /^([^:.]{1,40}):\s*(.*)$/.exec(line);
      if (!match) {
        this.body(line, options);
        continue;
      }
      const [, label, rest] = match;
      const head = `${label}:`;
      const indent = measure(`${head} `, "bold", size);
      // Fit what it can beside the label, then let the remainder run full width.
      const words = rest.split(/\s+/).filter(Boolean);
      let first = "";
      let taken = 0;
      while (taken < words.length) {
        const candidate = first ? `${first} ${words[taken]}` : words[taken];
        if (measure(candidate, "regular", size) > this.width - indent) break;
        first = candidate;
        taken += 1;
      }
      this.need(lead);
      this.pdf.text(head, this.left, this.y + size, "bold", size);
      if (first) this.pdf.text(first, this.left + indent, this.y + size, "regular", size, options.gray ?? 0);
      this.y += lead;
      const remainder = words.slice(taken).join(" ");
      if (remainder) this.body(remainder, options);
    }
  }

  /**
   * A label and its value side by side, the label in a fixed left column.
   *
   * Both are set at the same size, and the label is bold and black. It used to be
   * smaller than its value and set in grey, so it was heavier and paler than the
   * thing it named at once, which is what made these rows look muddy.
   */
  field(label: string, value: string, labelWidth = 92): void {
    if (!value) return;
    const lines = wrap(value, "regular", SIZE.body, this.width - labelWidth);
    this.need(Math.max(lines.length, 1) * LEAD.list + 2);
    this.pdf.text(label, this.left, this.y + SIZE.body, "bold", SIZE.body);
    let first = true;
    for (const line of lines) {
      if (!first) this.need(LEAD.list);
      this.pdf.text(line, this.left + labelWidth, this.y + SIZE.body, "regular", SIZE.body);
      this.y += LEAD.list;
      first = false;
    }
    this.y += 2;
  }

  bullet(value: string, marker = "•"): void {
    const indent = 14;
    const lines = wrap(value, "regular", SIZE.body, this.width - indent);
    this.need(lines.length * LEAD.list);
    this.pdf.text(marker, this.left + 2, this.y + SIZE.body, "regular", SIZE.body, GRAY.soft);
    for (const line of lines) {
      this.need(LEAD.list);
      this.pdf.text(line, this.left + indent, this.y + SIZE.body, "regular", SIZE.body);
      this.y += LEAD.list;
    }
  }

  /** A numbered step, the number set in its own column. Used by standards. */
  step(index: number, value: string): void {
    const indent = 24;
    const lines = wrap(value, "regular", SIZE.body, this.width - indent);
    this.need(Math.max(lines.length * LEAD.body, 18) + 4);
    this.pdf.text(`${index}`, this.left + 1, this.y + SIZE.body, "bold", SIZE.body, GRAY.soft);
    for (const line of lines) {
      this.need(LEAD.body);
      this.pdf.text(line, this.left + indent, this.y + SIZE.body, "regular", SIZE.body);
      this.y += LEAD.body;
    }
    this.y += 5;
  }

  rule(): void {
    this.need(12);
    this.pdf.fill(this.left, this.y + 4, this.width, 0.5, GRAY.rule);
    this.y += 13;
  }

  /**
   * Draw a ruled box around whatever `contents` puts on the page. Used for the
   * allergen block, which has to be the thing your eye lands on.
   */
  box(contents: () => void): void {
    const padding = 9;
    const startPage = this.pdf.pageCount;
    const outerLeft = this.left;
    const outerWidth = this.width;
    const top = this.y;
    this.y += padding;
    this.insetLeft += 10;
    this.insetRight += 10;
    contents();
    this.insetLeft -= 10;
    this.insetRight -= 10;
    this.y += padding - 3;
    if (this.pdf.pageCount === startPage) {
      this.pdf.stroke(outerLeft, top, outerWidth, this.y - top, 0.55, 1);
    } else {
      // A box split across a page break cannot be one rectangle. The rule under
      // the last line keeps the block closed and nothing runs off the paper.
      this.rule();
    }
    this.y += 8;
  }

  /**
   * The photograph in the left margin, with text running alongside it.
   *
   * A picture across the full column is three inches tall on US Letter, which
   * is most of what a cook sees when they pick the sheet up, and it pushes the
   * dish onto a second page. Beside the description it earns its space: the
   * page stays one sheet and the eye gets the picture and the words together.
   */
  photoBeside(
    jpeg: Jpeg,
    contents: () => void,
    boxWidth = 150,
    maxHeight = 160,
    minHeight = maxHeight,
  ): void {
    // Fit the picture inside the box on whichever side runs out first. A tall
    // photograph hits the height, and is then narrower than the box it was given
    // — so the text is inset by what was actually drawn rather than by what was
    // asked for, or a bottle leaves a strip of nothing down its side.
    const fit = (height: number) => {
      const scale = Math.min(boxWidth / jpeg.width, height / jpeg.height);
      return { width: jpeg.width * scale, height: jpeg.height * scale };
    };
    const full = fit(maxHeight);
    const floor = fit(Math.min(minHeight, maxHeight));

    // Then let the picture come down to meet the words. The block beside it is
    // set twice without ink to find out how tall it is — once in the column the
    // biggest picture would leave, once in the column the measured one leaves,
    // because a wider column means fewer lines. It never shrinks past the floor:
    // below that you can no longer see the ice, the garnish or the glass, which
    // is the only reason to put a photograph on a card at all.
    let { width: drawn, height } = full;
    if (floor.height < full.height) {
      for (let pass = 0; pass < 2; pass += 1) {
        this.insetLeft += drawn + 14;
        const words = this.measuring(contents);
        this.insetLeft -= drawn + 14;
        const wanted = Math.min(full.height, Math.max(words, floor.height));
        ({ width: drawn, height } = fit(wanted));
      }
    }

    this.need(Math.max(height, 46) + 8);
    const top = this.y;
    this.pdf.image(jpeg, this.left, top, drawn, height);
    this.insetLeft += drawn + 14;
    contents();
    this.insetLeft -= drawn + 14;
    // Whichever ran longer, the picture or the words, decides where the next
    // block starts.
    this.y = Math.max(this.y, top + height) + 10;
  }

  /**
   * How tall a block comes out, without drawing it. A block that breaks the page
   * is taller than anything worth sizing against, so it answers infinity and the
   * caller falls back to its largest option.
   */
  private measuring(render: () => void): number {
    const top = this.y;
    let end = top;
    this.pdf.trial(() => {
      render();
      end = this.y;
    });
    this.y = top;
    return end >= top ? end - top : Number.POSITIVE_INFINITY;
  }

  /**
   * Short items in columns. An ingredient list is a dozen one- or two-word
   * lines; down a single column it costs half a page and reads like a poem.
   * Anything too long for a column falls back to the full width.
   */
  columns(items: string[], count = 3): void {
    if (!items.length) return;
    const gutter = 10;
    const indent = 9;
    const colWidth = (this.width - gutter * (count - 1)) / count;
    const fits = items.every(
      (item) => wrap(item, "regular", SIZE.body, colWidth - indent).length === 1,
    );
    if (!fits || count < 2) {
      for (const item of items) this.bullet(item);
      return;
    }
    const rows = Math.ceil(items.length / count);
    this.need(rows * LEAD.list + 4);
    const top = this.y;
    for (let column = 0; column < count; column += 1) {
      const x = this.left + column * (colWidth + gutter);
      let y = top;
      for (const item of items.slice(column * rows, (column + 1) * rows)) {
        this.pdf.text("\u2022", x + 1, y + SIZE.body, "regular", SIZE.body, GRAY.soft);
        this.pdf.text(item, x + indent, y + SIZE.body, "regular", SIZE.body);
        y += LEAD.list;
      }
    }
    this.y = top + rows * LEAD.list + 2;
  }

  /**
   * A cocktail spec: how much, then of what.
   *
   *     2      oz pisco quebranta
   *     0.75   oz passion fruit puree
   *     0.5    oz fresh lime juice
   *
   * Quantities are the one thing on a spec that is read downwards rather than
   * across, so they get a column of their own, as wide as the longest of them.
   * Nothing in the database separates the amount from the ingredient — a spec is
   * typed as free text — so the amount is found by shape: a run of digits,
   * fractions or a measure at the start of a line. A line that does not begin
   * that way is not a pour ("Top with ginger beer", "Build over one block") and
   * runs the full width instead of being forced into a column it does not fit.
   */
  amounts(lines: string[], options: { size?: number } = {}): void {
    const size = options.size ?? SIZE.body;
    const lead = size <= SIZE.small ? LEAD.small : LEAD.list;
    const parsed = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // A number, optionally followed by a fraction ("1 1/2", "1 ½"), optionally
        // followed by a measure. Then a space, then what it is.
        const number = "\\d+(?:[.,]\\d+)?";
        const fraction = "(?:\\d+\\s*/\\s*\\d+|[\\u00bc\\u00bd\\u00be])";
        const unit = "(?:oz|ml|cl|l|g|kg|dash(?:es)?|drops?|tsp|tbsp|bsp|bar\\s?spoons?|parts?|splash(?:es)?)";
        const match = new RegExp(
          `^((?:${number}|${fraction})(?:\\s*${fraction})?\\s*${unit}?\\.?)\\s+(\\S.*)$`,
          "i",
        ).exec(line);
        return match ? { amount: match[1].trim(), rest: match[2] } : { amount: "", rest: line };
      });
    const widest = Math.max(0, ...parsed.map((entry) => measure(entry.amount, "bold", size)));
    // If the amounts are so long that the ingredients would be squeezed into a
    // third of the column, they are probably not amounts. Set the lot as text.
    const column = widest && widest < this.width * 0.34 ? widest + 10 : 0;
    for (const { amount, rest } of parsed) {
      if (!column || !amount) {
        this.body(rest, { size });
        continue;
      }
      const rows = wrap(rest, "regular", size, this.width - column);
      // Keep the amount and its ingredient on the same page as each other.
      this.need(rows.length * lead);
      this.pdf.text(amount, this.left, this.y + size, "bold", size);
      for (const row of rows) {
        this.pdf.text(row, this.left + column, this.y + size, "regular", size);
        this.y += lead;
      }
    }
  }

  /**
   * A full-width band naming a group and how many things are in it.
   *
   * On an index sheet the group is the thing that matters most — on an allergy
   * sheet it is the difference between a dish you may serve and one you may not
   * — and a bold line of type the same size as everything else does not say so.
   * A band does, from across a room, before a word has been read. `tone` is the
   * fill: dark for the dangerous end, pale for the safe one. Text turns white
   * when the band is dark enough to need it.
   */
  band(label: string, count: number | string, tone: number): void {
    const height = 16;
    this.need(height + 10);
    const ink = tone < 0.5 ? 1 : 0;
    this.pdf.fill(this.left, this.y, this.width, height, tone);
    this.pdf.text(label, this.left + 7, this.y + 12, "bold", 10, ink);
    const tally = String(count);
    this.pdf.text(
      tally,
      this.left + this.width - measure(tally, "bold", 10) - 7,
      this.y + 12,
      "bold",
      10,
      tone < 0.5 ? 1 : 0.35,
    );
    this.y += height + 6;
  }

  /**
   * Section by section, in columns: a heading, its items under it, and the next
   * section starting underneath.
   *
   * A long list run on behind its heading is compact but it is a wall — you read
   * it rather than scan it, and you lose your place. One name to a line is how
   * somebody actually looks a dish up; columns are what stop that costing four
   * pages. Blocks are dealt into the columns by height so they come out level,
   * and a section is never split across a column break unless it is taller than
   * the column itself.
   *
   * The column count does not follow the amount of content. It is fixed, so the
   * columns land in the same place in every block and on every page: a sheet
   * where the second column moves each time is the thing that reads as a mess,
   * whatever is in it. There are no bullets either — the indent already says a
   * name belongs to the heading above it, and a marker on every single line
   * carries no information while making a ragged edge of the margin.
   */
  blocks(groups: [string, string[]][], count = 3): void {
    if (!groups.length) return;
    const gutter = 16;
    const indent = 9;
    const size = 9;
    const lead = 10;
    const headLead = 11.5;
    const gapAfter = 5;
    const columnWidth = (this.width - gutter * (count - 1)) / count;

    const laid = groups.map(([heading, names]) => {
      const rows: string[] = [];
      for (const name of names) rows.push(...wrap(name, "regular", size, columnWidth - indent));
      return { heading, rows, height: headLead + rows.length * lead + gapAfter };
    });

    const target = laid.reduce((sum, block) => sum + block.height, 0) / count;
    const columns: (typeof laid)[] = Array.from({ length: count }, () => []);
    let index = 0;
    let used = 0;
    for (const block of laid) {
      // Move on once this column has had its share, judged at the block's middle
      // so a tall section does not tip every later column short.
      if (index < count - 1 && used > 0 && used + block.height / 2 > target) {
        index += 1;
        used = 0;
      }
      columns[index].push(block);
      used += block.height;
    }

    this.need(Math.max(...columns.map((c) => c.reduce((sum, b) => sum + b.height, 0))) + 4);
    const top = this.y;
    let deepest = top;
    for (let column = 0; column < count; column += 1) {
      const x = this.left + column * (columnWidth + gutter);
      let y = top;
      for (const block of columns[column]) {
        this.pdf.text(block.heading, x, y + size, "bold", size);
        y += headLead;
        for (const row of block.rows) {
          this.pdf.text(row, x + indent, y + size, "regular", size);
          y += lead;
        }
        y += gapAfter;
      }
      deepest = Math.max(deepest, y);
    }
    this.y = deepest;
  }

  /**
   * The photograph, across the full column. Height follows the aspect ratio up
   * to a cap, so a tall picture cannot push everything that matters onto a
   * second sheet of paper. This is the one place colour is allowed.
   */
  photo(jpeg: Jpeg, maxHeight = 268): void {
    let width = this.width;
    let height = (jpeg.height / jpeg.width) * width;
    if (height > maxHeight) {
      height = maxHeight;
      width = (jpeg.width / jpeg.height) * height;
    }
    this.need(height + 14);
    this.pdf.image(jpeg, this.left + (this.width - width) / 2, this.y, width, height);
    this.y += height + 14;
  }

  /**
   * One answer on a quiz: a square to tick, and the answer beside it. The square
   * is drawn rather than typed, because the typeface a PDF reader is guaranteed
   * to have has no box in it. Filled means this is the right answer.
   */
  choice(label: string, marked = false): void {
    const square = 9;
    const indent = 19;
    const lines = wrap(label, "regular", SIZE.body, this.width - indent);
    this.need(Math.max(lines.length * LEAD.body, 16));
    const top = this.y + 3;
    this.pdf.stroke(this.left + 2, top, square, square, marked ? 0.1 : 0.45, marked ? 1.1 : 0.9);
    if (marked) this.pdf.fill(this.left + 4.4, top + 2.4, square - 4.8, square - 4.8, 0.1);
    for (const line of lines) {
      this.need(LEAD.body);
      this.pdf.text(line, this.left + indent, this.y + SIZE.body, marked ? "bold" : "regular", SIZE.body);
      this.y += LEAD.body;
    }
  }

  /** A row of tick boxes for marking by hand. */
  tickRow(label: string, boxes: number): void {
    const size = 10;
    this.need(20);
    let x = this.left;
    for (let i = 0; i < boxes; i += 1) {
      this.pdf.stroke(x, this.y + 2, size, size, 0.45, 0.9);
      x += size + 7;
    }
    this.pdf.text(label, x + 2, this.y + size, "regular", SIZE.small, GRAY.soft);
    this.y += 20;
  }

  /** A ruled line for writing a name or a date on. */
  writeLine(label: string, width = 190): void {
    this.need(26);
    this.pdf.text(label, this.left, this.y + SIZE.small, "regular", SIZE.small, GRAY.soft);
    const at = this.left + measure(label, "regular", SIZE.small) + 8;
    this.pdf.fill(at, this.y + SIZE.small + 2, width, 0.6, 0.5);
    this.y += 24;
  }

  /** Finish the document. Page numbers are resolved here, once the total is known. */
  finish(title: string): Uint8Array {
    const total = this.pdf.pageCount;
    for (let page = 0; page < total; page += 1) {
      this.pdf.appendToPage(page, () => this.drawFooter(page + 1, total));
    }
    return this.pdf.build(title);
  }
}
