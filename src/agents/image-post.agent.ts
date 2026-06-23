import fs from 'fs-extra';
import path from 'path';
import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { ask } from '../utils/ai';
import { log } from '../utils/logger';
import {
  getAllScripts,
  getScriptsByIds,
  type ScriptWithTopic,
} from '../db/repository';

// ────────────────────────────────────────────────────────────────────────────
// Design system (mirrors carousel.agent.ts; intentionally separate so the two
// can evolve independently)
// ────────────────────────────────────────────────────────────────────────────

const W = 1080;
const H = 1920;
const PAD = 80;

const COLOR_BLACK = '#000000';
const COLOR_PURPLE = '#0a0008';
const COLOR_WHITE = '#FFFFFF';
const COLOR_RED = '#CC0000';

const IMG_DIR = path.join(process.cwd(), 'output', 'image-posts');
const READY_DIR = path.join(process.cwd(), 'output', 'ready-to-post');
const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'Oswald-Bold.ttf');
const LOGO_PATH = path.join(process.cwd(), 'assets', 'branding', 'logo.png');

let logoImage: Image | null | undefined;
async function getLogo(): Promise<Image | null> {
  if (logoImage !== undefined) return logoImage;
  if (!(await fs.pathExists(LOGO_PATH))) {
    log.warn(`  logo missing at ${LOGO_PATH} — image posts will skip the logo image.`);
    logoImage = null;
    return null;
  }
  try {
    logoImage = await loadImage(LOGO_PATH);
    return logoImage;
  } catch (err) {
    log.warn(`  failed to load logo: ${err instanceof Error ? err.message : String(err)}`);
    logoImage = null;
    return null;
  }
}

function drawLogo(
  ctx: SKRSContext2D,
  img: Image | null,
  x: number,
  y: number,
  size: number,
  opacity = 1
): void {
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

/** Standard top header: logo (80×80) + "MIND SHIELD DAILY" + red separator. */
function drawTopHeader(ctx: SKRSContext2D, logo: Image | null): void {
  drawLogo(ctx, logo, (W - 80) / 2, 50, 80);

  ctx.save();
  ctx.fillStyle = COLOR_WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 22px Oswald`;
  const text = 'MIND SHIELD DAILY';
  const tracking = 5;
  const totalW =
    Array.from(text).reduce(
      (acc, ch) => acc + ctx.measureText(ch).width + tracking,
      0
    ) - tracking;
  let cx = W / 2 - totalW / 2;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, 150);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();

  // Thin red separator, 200px wide, centered at y=170.
  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(W / 2 - 100, 170, 200, 2);
}

/** Standard bottom handle (centered, 50% opacity, y=1840). */
function drawBottomHandle(ctx: SKRSContext2D): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = COLOR_WHITE;
  ctx.font = `bold 28px Oswald`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('@mindshieldaily', W / 2, 1840);
  ctx.restore();
}

let fontRegistered = false;
function ensureFont(): void {
  if (fontRegistered) return;
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`Font missing: ${FONT_PATH}`);
  }
  GlobalFonts.registerFromPath(FONT_PATH, 'Oswald');
  fontRegistered = true;
}

// ────────────────────────────────────────────────────────────────────────────
// LLM-driven content extraction
// ────────────────────────────────────────────────────────────────────────────

interface ImageContent {
  quote: string;          // for QUOTE card — protection tip / retention twist
  conceptName: string;    // for DEFINITION card
  definition: string;     // for DEFINITION card
  warning: string;        // for WARNING card — punchy red-flag sign
  stat: string | null;    // for STAT card — a percentage or count; null if none in script
  statContext: string;    // explanatory sentence for the stat
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text.trim();
}

async function extractImageContent(script: ScriptWithTopic): Promise<ImageContent> {
  const prompt = `You convert a dark-psychology video script into single-image-post copy. Output is shown on a 1080×1920 mobile card — every word must earn its place.

HOOK: ${script.hook}
VOICEOVER:
${script.voice_script}

Return ONLY JSON. Use ONLY single quotes inside string values (double quotes break JSON).

{
  "quote": "the most punchy standalone protective tip from the voiceover, max 110 chars, no quote marks",
  "conceptName": "the named psychological concept, 1-3 words, will be displayed UPPERCASE",
  "definition": "one-sentence definition of the concept, max 110 chars",
  "warning": "single red-flag warning derived from a sign, max 80 chars, urgent tone",
  "stat": "ONLY if the voiceover contains an explicit number/percentage/statistic, return it as a short string like '90%' or '1 in 4'. If no stat appears, return null (literal JSON null, not the string 'null').",
  "statContext": "one-sentence context for the stat, max 100 chars, or empty string if no stat"
}`;

  const raw = await ask(prompt, { json: true });
  const parsed = JSON.parse(extractJson(raw)) as Partial<ImageContent>;
  if (!parsed.quote || !parsed.conceptName) {
    throw new Error('Image extraction returned incomplete data');
  }

  // Coerce stat: accept null, '', or actual string. Empty/unknown → null.
  const statRaw = parsed.stat;
  const stat = (typeof statRaw === 'string' && statRaw.trim() && !/^null$/i.test(statRaw))
    ? statRaw.trim()
    : null;

  return {
    quote: parsed.quote.replace(/^["']|["']$/g, '').slice(0, 140),
    conceptName: parsed.conceptName.toUpperCase().slice(0, 30),
    definition: (parsed.definition ?? '').slice(0, 140),
    warning: (parsed.warning ?? '').slice(0, 110),
    stat,
    statContext: (parsed.statContext ?? '').slice(0, 110),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas primitives (light copy of carousel helpers — keeping local so the
// two files don't grow a shared dependency surface)
// ────────────────────────────────────────────────────────────────────────────

function newCanvas() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

function fillBg(ctx: SKRSContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number, maxWordsPerLine?: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line: string[] = [];
  for (const w of words) {
    const tentative = [...line, w].join(' ');
    const overWidth = ctx.measureText(tentative).width > maxWidth;
    const overWords = maxWordsPerLine != null && line.length >= maxWordsPerLine;
    if (overWidth || overWords) {
      if (line.length > 0) lines.push(line.join(' '));
      line = [w];
    } else {
      line.push(w);
    }
  }
  if (line.length > 0) lines.push(line.join(' '));
  return lines;
}

interface DrawTextOpts {
  text: string;
  cy: number;
  fontSize: number;
  minFontSize?: number;
  color?: string;
  weight?: 'bold' | 'normal';
  italic?: boolean;
  align?: 'center' | 'left' | 'right';
  x?: number;
  maxWidth?: number;
  maxHeight?: number;
  lineHeight?: number;
  opacity?: number;
  letterSpacingTracked?: number;
  maxWordsPerLine?: number;
}

function drawWrappedText(ctx: SKRSContext2D, opts: DrawTextOpts): number {
  const {
    text,
    cy,
    minFontSize = 28,
    color = COLOR_WHITE,
    weight = 'bold',
    italic = false,
    align = 'center',
    x = W / 2,
    maxWidth = W - PAD * 2,
    maxHeight = H - PAD * 2,
    lineHeight = 1.2,
    opacity = 1,
    letterSpacingTracked = 0,
    maxWordsPerLine,
  } = opts;
  let fontSize = opts.fontSize;
  let lines: string[] = [];

  while (fontSize >= minFontSize) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px Oswald`;
    lines = wrapLines(ctx, text, maxWidth, maxWordsPerLine);
    const blockH = lines.length * fontSize * lineHeight;
    if (blockH <= maxHeight) break;
    fontSize -= 4;
  }

  const blockH = lines.length * fontSize * lineHeight;
  const startY = cy - blockH / 2 + fontSize * 0.85;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = startY + i * fontSize * lineHeight;
    if (letterSpacingTracked > 0 && align === 'center') {
      const totalW =
        Array.from(line).reduce(
          (acc, ch) => acc + ctx.measureText(ch).width + letterSpacingTracked,
          0
        ) - letterSpacingTracked;
      let cx = W / 2 - totalW / 2;
      ctx.textAlign = 'left';
      for (const ch of line) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + letterSpacingTracked;
      }
      ctx.textAlign = align;
    } else {
      ctx.fillText(line, align === 'left' ? x : align === 'right' ? W - PAD : W / 2, y);
    }
  }
  ctx.restore();
  return blockH;
}

function thinHorizontalLine(ctx: SKRSContext2D, cy: number, color = COLOR_RED, width = 140, thickness = 3): void {
  ctx.fillStyle = color;
  ctx.fillRect(W / 2 - width / 2, cy, width, thickness);
}

/** Subtle noise overlay to give cards texture. ~3% opacity. */
function addNoise(ctx: SKRSContext2D, alpha = 0.03): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Skip ~70% of pixels for performance — sparse noise is what we want anyway.
    if (Math.random() > 0.3) continue;
    const n = (Math.random() - 0.5) * 255 * alpha * 2;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Card renderers
// ────────────────────────────────────────────────────────────────────────────

export type ImageType = 'quote' | 'definition' | 'warning' | 'stat';

function renderQuote(content: ImageContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_BLACK);

  // Subtle large faded logo behind quote text (4% opacity, 600×600, centered).
  drawLogo(ctx, logo, (W - 600) / 2, (H - 600) / 2, 600, 0.04);

  // Top header replaces the old "@mindshieldaily" + thin line block.
  drawTopHeader(ctx, logo);

  // Quote — centered, shifted slightly to leave the new header room.
  drawWrappedText(ctx, {
    text: content.quote,
    cy: H * 0.5,
    fontSize: 78,
    minFontSize: 44,
    maxHeight: H * 0.5,
    lineHeight: 1.25,
    maxWordsPerLine: 8,
  });

  thinHorizontalLine(ctx, H * 0.82);

  drawWrappedText(ctx, {
    text: '— Dark Psychology',
    cy: H * 0.88,
    fontSize: 40,
    italic: true,
    weight: 'normal',
  });

  drawBottomHandle(ctx);
  addNoise(ctx, 0.03);
  return canvas.toBuffer('image/png');
}

function renderDefinition(content: ImageContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_PURPLE);

  // Faded logo replaces the rotated faded term-name decoration (400×400, 6%).
  drawLogo(ctx, logo, (W - 400) / 2, (H - 400) / 2, 400, 0.06);

  drawTopHeader(ctx, logo);

  // Term name centered, pushed slightly below the new header.
  drawWrappedText(ctx, {
    text: content.conceptName,
    cy: H * 0.38,
    fontSize: 110,
    minFontSize: 70,
    color: COLOR_RED,
    maxHeight: H * 0.3,
    letterSpacingTracked: 8,
    maxWordsPerLine: 3,
  });

  thinHorizontalLine(ctx, H * 0.55, COLOR_WHITE, 200, 2);

  drawWrappedText(ctx, {
    text: content.definition,
    cy: H * 0.72,
    fontSize: 60,
    minFontSize: 38,
    maxHeight: H * 0.3,
    lineHeight: 1.3,
    maxWordsPerLine: 6,
  });

  drawBottomHandle(ctx);
  return canvas.toBuffer('image/png');
}

function renderWarning(content: ImageContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_BLACK);

  // Left red border full height
  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(0, 0, 8, H);

  // Top red banner — keep dominant for this card type. Logo lives INSIDE it
  // (left of the ⚠ RED FLAG text) so we skip the standard top header.
  const bannerTop = H * 0.1;
  const bannerHeight = H * 0.18;
  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(0, bannerTop, W, bannerHeight);

  // Small 50×50 white-tinted logo inside the bar, vertically centered.
  if (logo) {
    const logoSize = 50;
    const logoX = 60;
    const logoY = bannerTop + bannerHeight / 2 - logoSize / 2;
    drawLogo(ctx, logo, logoX, logoY, logoSize, 0.9);
    // White tint pass over the same rect (multiply white via destination-atop trick).
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillRect(logoX, logoY, logoSize, logoSize);
    ctx.restore();
  }

  drawWrappedText(ctx, {
    text: '⚠ RED FLAG',
    cy: bannerTop + bannerHeight / 2,
    fontSize: 90,
    color: COLOR_WHITE,
    maxHeight: bannerHeight * 0.9,
    letterSpacingTracked: 4,
  });

  // Warning text middle
  drawWrappedText(ctx, {
    text: content.warning,
    cy: H * 0.55,
    fontSize: 78,
    minFontSize: 48,
    maxHeight: H * 0.38,
    lineHeight: 1.25,
    maxWordsPerLine: 8,
  });

  // CTA above the bottom handle.
  drawWrappedText(ctx, {
    text: 'Protect yourself. Follow @mindshieldaily',
    cy: H * 0.88,
    fontSize: 38,
    opacity: 0.5,
    maxWordsPerLine: 8,
  });

  drawBottomHandle(ctx);
  return canvas.toBuffer('image/png');
}

function renderStat(content: ImageContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();

  // Radial gradient background — dark red center → black edges.
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H));
  grad.addColorStop(0, '#2a0000');
  grad.addColorStop(1, COLOR_BLACK);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  drawTopHeader(ctx, logo);

  // Logo above the number (120×120, y=400) with a slight red tint.
  if (logo) {
    const lx = (W - 120) / 2;
    const ly = 400;
    drawLogo(ctx, logo, lx, ly, 120, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = COLOR_RED;
    ctx.fillRect(lx, ly, 120, 120);
    ctx.restore();
  }

  // Huge stat number — moved down to make room for the logo.
  drawWrappedText(ctx, {
    text: content.stat ?? '?',
    cy: H * 0.52,
    fontSize: 260,
    minFontSize: 140,
    color: COLOR_RED,
    maxHeight: H * 0.32,
    maxWordsPerLine: 2,
  });

  // Context below
  drawWrappedText(ctx, {
    text: content.statContext || content.conceptName,
    cy: H * 0.78,
    fontSize: 58,
    minFontSize: 36,
    maxHeight: H * 0.18,
    lineHeight: 1.3,
    maxWordsPerLine: 7,
  });

  drawBottomHandle(ctx);
  return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

const TYPES_BY_MOD: Record<number, ImageType> = {
  0: 'quote',
  1: 'definition',
  2: 'warning',
  3: 'stat',
};

export function pickImageType(scriptId: number): ImageType {
  return TYPES_BY_MOD[scriptId % 4];
}

function renderByType(type: ImageType, content: ImageContent, logo: Image | null): Buffer {
  switch (type) {
    case 'quote':      return renderQuote(content, logo);
    case 'definition': return renderDefinition(content, logo);
    case 'warning':    return renderWarning(content, logo);
    case 'stat':       return renderStat(content, logo);
  }
}

interface GenerateOpts {
  type?: ImageType;       // override the rotation
  suffix?: string;        // appended to filename (used by --all to disambiguate)
}

/**
 * Generate one image post for `script`. Rotation by id%4 unless `type` is
 * supplied. Falls back from `stat` → `quote` when the script contains no stat.
 */
export async function generateImagePost(
  script: ScriptWithTopic,
  opts: GenerateOpts = {}
): Promise<{ path: string; type: ImageType }> {
  ensureFont();
  await fs.ensureDir(IMG_DIR);

  const [content, logo] = await Promise.all([
    extractImageContent(script),
    getLogo(),
  ]);

  const typeWasForced = opts.type != null;
  let type: ImageType = opts.type ?? pickImageType(script.id);
  // Only auto-fall back when the type came from the rotation. If the caller
  // explicitly asked for `stat` (e.g. --all preview), render it with a "?"
  // placeholder rather than silently producing a duplicate quote card.
  if (type === 'stat' && !content.stat && !typeWasForced) {
    log.info(`  no stat found in script ${script.id} → falling back to quote`);
    type = 'quote';
  }

  const buf = renderByType(type, content, logo);
  const suffix = opts.suffix ? `_${opts.suffix}` : '';
  const outPath = path.join(IMG_DIR, `script_${script.id}_image${suffix}.png`);
  await fs.writeFile(outPath, buf);

  await writeImageGuide(script, outPath, type);

  return { path: outPath, type };
}

function buildGuide(script: ScriptWithTopic, imgPath: string, type: ImageType): string {
  const typeLabel = type[0].toUpperCase() + type.slice(1);
  return [
    '╔══════════════════════════════════════════╗',
    `║   TIKTOK IMAGE POST — Script #${String(script.id).padEnd(10)}║`,
    '╠══════════════════════════════════════════╣',
    `║ TYPE: ${typeLabel.padEnd(35)}║`,
    `║ FILE: ${path.basename(imgPath).padEnd(35)}║`,
    '╠══════════════════════════════════════════╣',
    `║ CAPTION: ${(script.caption ?? '').slice(0, 32).padEnd(32)}║`,
    `║ HASHTAGS: ${(script.hashtags ?? '').slice(0, 31).padEnd(31)}║`,
    '╠══════════════════════════════════════════╣',
    '║ 🎵 Add trending dark sound on upload     ║',
    '╚══════════════════════════════════════════╝',
    '',
    'FULL IMAGE PATH:',
    `  ${imgPath}`,
    '',
    'FULL CAPTION (copy exactly):',
    script.caption ?? '',
    '',
    'FULL HASHTAGS (copy exactly):',
    script.hashtags ?? '',
    '',
  ].join('\n');
}

async function writeImageGuide(script: ScriptWithTopic, imgPath: string, type: ImageType): Promise<void> {
  await fs.ensureDir(READY_DIR);
  const guidePath = path.join(READY_DIR, `script_${script.id}_image.txt`);
  await fs.writeFile(guidePath, buildGuide(script, imgPath, type), 'utf8');
  log.info(`  📂 Image guide: ${guidePath}`);
}

async function listScriptsNeedingImage(): Promise<ScriptWithTopic[]> {
  const all = getAllScripts();
  const tiktokScripts = all.filter((s) => s.platform === 'tiktok');
  const out: ScriptWithTopic[] = [];
  for (const s of tiktokScripts) {
    const candidate = path.join(IMG_DIR, `script_${s.id}_image.png`);
    if (!(await fs.pathExists(candidate))) out.push(s);
  }
  return out;
}

export interface RunImagesOpts {
  onlyIds?: number[];
  force?: boolean;
  /** Render ALL 4 types for each script (testing/preview). */
  all?: boolean;
}

export async function runImages(opts: RunImagesOpts = {}): Promise<number[]> {
  await fs.ensureDir(IMG_DIR);

  let targets: ScriptWithTopic[];
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    targets = getScriptsByIds(opts.onlyIds);
  } else {
    targets = await listScriptsNeedingImage();
  }

  if (targets.length === 0) {
    log.warn('No scripts need an image post.');
    return [];
  }

  log.info(`📸 ${targets.length} script(s) to process${opts.all ? ' (--all: rendering 4 types each)' : ''}.`);

  const produced: number[] = [];
  for (const s of targets) {
    try {
      if (opts.all) {
        const types: ImageType[] = ['quote', 'definition', 'warning', 'stat'];
        for (const t of types) {
          const { path: p, type } = await generateImagePost(s, { type: t, suffix: t });
          log.success(`  ✅ script ${s.id} [${type}] → ${path.basename(p)}`);
        }
      } else {
        const defaultPath = path.join(IMG_DIR, `script_${s.id}_image.png`);
        if (!opts.force && (await fs.pathExists(defaultPath))) {
          log.info(`  ✓ script ${s.id} already has image — skipping`);
          continue;
        }
        log.info(`📸 Generating image post for script ${s.id} — ${s.topic_title}`);
        const { path: p, type } = await generateImagePost(s);
        log.success(`  ✅ [${type}] → ${path.basename(p)}`);
      }
      produced.push(s.id);
    } catch (err) {
      log.error(`  image-post failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return produced;
}
