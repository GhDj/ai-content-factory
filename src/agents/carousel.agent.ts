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
// Design system
// ────────────────────────────────────────────────────────────────────────────

const W = 1080;
const H = 1920;
const PAD = 80;

const COLOR_BLACK = '#000000';
const COLOR_PURPLE = '#0a0008';
const COLOR_WHITE = '#FFFFFF';
const COLOR_RED = '#CC0000';

const CAROUSEL_DIR = path.join(process.cwd(), 'output', 'carousels');
const READY_DIR = path.join(process.cwd(), 'output', 'ready-to-post');
const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'Oswald-Bold.ttf');
const LOGO_PATH = path.join(process.cwd(), 'assets', 'branding', 'logo.png');

let logoImage: Image | null | undefined; // undefined = not yet attempted; null = missing
async function getLogo(): Promise<Image | null> {
  if (logoImage !== undefined) return logoImage;
  if (!(await fs.pathExists(LOGO_PATH))) {
    log.warn(`  logo missing at ${LOGO_PATH} — carousels will skip the logo image.`);
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

// Register Oswald once. GlobalFonts is process-wide.
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
// LLM-driven slide content extraction
// ────────────────────────────────────────────────────────────────────────────

interface Sign {
  title: string;
  detail: string;
}

interface SlideContent {
  hook: string;
  conceptName: string;
  conceptExplanation: string;
  signs: Sign[]; // 3 entries
  example: string;
  protectionTip: string;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text.trim();
}

async function extractSlideContent(script: ScriptWithTopic): Promise<SlideContent> {
  const prompt = `You convert a dark-psychology video voiceover into structured TikTok carousel slide content.

VOICEOVER:
${script.voice_script}

HOOK: ${script.hook}

Extract these fields and return ONLY JSON (no markdown). Keep text punchy — these are mobile carousel slides, every word visible.

{
  "hook": "short attention-grabbing line, max 90 chars (you may rephrase '${script.hook.replace(/"/g, "'")}' tighter if too long)",
  "conceptName": "1-3 word psychological term, uppercase or title case (e.g. 'STONEWALLING')",
  "conceptExplanation": "one-sentence definition, max 110 chars, plain language",
  "signs": [
    {"title": "Sign 1 in 2-5 words", "detail": "1 sentence elaboration, max 90 chars"},
    {"title": "Sign 2 in 2-5 words", "detail": "1 sentence elaboration, max 90 chars"},
    {"title": "Sign 3 in 2-5 words", "detail": "1 sentence elaboration, max 90 chars"}
  ],
  "example": "relatable everyday scenario, 1-2 short sentences, max 140 chars total",
  "protectionTip": "one actionable protective tip, 1 sentence, max 110 chars"
}

CRITICAL: inside string values use ONLY single quotes ('like this'), never double quotes — they break JSON.`;

  const raw = await ask(prompt, { json: true });
  const parsed = JSON.parse(extractJson(raw)) as Partial<SlideContent>;

  // Validate / coerce.
  if (!parsed.hook || !parsed.conceptName || !parsed.signs || parsed.signs.length < 3) {
    throw new Error('Carousel extraction returned incomplete data');
  }

  return {
    hook: parsed.hook,
    conceptName: parsed.conceptName.toUpperCase(),
    conceptExplanation: parsed.conceptExplanation ?? '',
    signs: parsed.signs.slice(0, 3).map((s) => ({
      title: String(s.title ?? '').slice(0, 60),
      detail: String(s.detail ?? '').slice(0, 110),
    })),
    example: parsed.example ?? '',
    protectionTip: parsed.protectionTip ?? '',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas drawing primitives
// ────────────────────────────────────────────────────────────────────────────

function fillBg(ctx: SKRSContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

function fillVerticalGradient(ctx: SKRSContext2D, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Wrap a string to fit within `maxWidth` at the current font, breaking on words. */
function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const tentative = line ? `${line} ${w}` : w;
    if (ctx.measureText(tentative).width <= maxWidth) {
      line = tentative;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw word-wrapped text centered horizontally, with `cy` being the vertical
 * center of the resulting block. Reduces font size if the block would
 * overflow `maxHeight`. Returns the resulting block height.
 */
interface DrawTextOpts {
  text: string;
  cy: number;             // vertical center of the block
  fontSize: number;       // initial font size
  minFontSize?: number;   // shrink-to-fit lower bound
  color?: string;
  weight?: 'bold' | 'normal';
  italic?: boolean;
  align?: 'center' | 'left';
  x?: number;             // when align=left, left edge
  maxWidth?: number;
  maxHeight?: number;
  lineHeight?: number;    // multiplier
  opacity?: number;
  letterSpacingTracked?: number; // px space between glyph pairs (cheap fake)
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
    lineHeight = 1.18,
    opacity = 1,
    letterSpacingTracked = 0,
  } = opts;
  let fontSize = opts.fontSize;
  let lines: string[] = [];

  // Shrink-to-fit loop.
  while (fontSize >= minFontSize) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px Oswald`;
    lines = wrapLines(ctx, text, maxWidth);
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
      // Cheap letter-spacing fallback for the small "MIND SHIELD DAILY" line.
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
      ctx.fillText(line, align === 'center' ? W / 2 : x, y);
    }
  }
  ctx.restore();
  return blockH;
}

function redAccentBar(ctx: SKRSContext2D, cy: number, width = 160, thickness = 5): void {
  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(W / 2 - width / 2, cy, width, thickness);
}

function leftRedBorder(ctx: SKRSContext2D, width = 8): void {
  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(0, 200, width, H - 400);
}

// ────────────────────────────────────────────────────────────────────────────
// Slide renderers (return Buffer)
// ────────────────────────────────────────────────────────────────────────────

function newCanvas() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

/** Tiny bottom-right brand watermark used on slides that don't have a hero logo. */
function drawCornerLogo(ctx: SKRSContext2D, logo: Image | null): void {
  // Spec: 60x60, x=980, y=1820, 25% opacity (bottom-right corner).
  drawLogo(ctx, logo, 980, 1820, 60, 0.25);
}

interface SeriesSlideInfo {
  seriesName: string;
  episodeNumber: number;
}

function renderSlide1Hook(content: SlideContent, logo: Image | null, seriesInfo?: SeriesSlideInfo): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_BLACK);

  // Logo top-center (100x100), then display name below, then red separator at y=200.
  drawLogo(ctx, logo, (W - 100) / 2, 60, 100);

  drawWrappedText(ctx, {
    text: 'MIND SHIELD DAILY',
    cy: 190,
    fontSize: 24,
    minFontSize: 24,
    color: COLOR_WHITE,
    letterSpacingTracked: 6,
  });

  ctx.fillStyle = COLOR_RED;
  ctx.fillRect(W / 2 - 80, 220, 160, 3);

  // Series badge above hook text
  let hookCy = H * 0.55;
  if (seriesInfo) {
    drawWrappedText(ctx, {
      text: seriesInfo.seriesName.toUpperCase(),
      cy: H * 0.28,
      fontSize: 36,
      minFontSize: 28,
      color: COLOR_RED,
      letterSpacingTracked: 4,
    });
    const epText = `EP. ${String(seriesInfo.episodeNumber).padStart(2, '0')}`;
    drawWrappedText(ctx, {
      text: epText,
      cy: H * 0.35,
      fontSize: 72,
      minFontSize: 56,
      color: COLOR_WHITE,
    });
    hookCy = H * 0.58;
  }

  drawWrappedText(ctx, {
    text: content.hook,
    cy: hookCy,
    fontSize: 92,
    minFontSize: 56,
    maxHeight: seriesInfo ? H * 0.4 : H * 0.55,
  });

  drawWrappedText(ctx, {
    text: 'SWIPE  →',
    cy: H * 0.88,
    fontSize: 44,
    opacity: 0.6,
    letterSpacingTracked: 6,
  });
  redAccentBar(ctx, H * 0.94);

  return canvas.toBuffer('image/png');
}

function renderSlide2Concept(content: SlideContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_PURPLE);

  drawWrappedText(ctx, {
    text: content.conceptName,
    cy: H * 0.38,
    fontSize: 140,
    minFontSize: 80,
    color: COLOR_RED,
    maxHeight: H * 0.35,
  });

  redAccentBar(ctx, H * 0.58, 100, 4);

  drawWrappedText(ctx, {
    text: content.conceptExplanation,
    cy: H * 0.7,
    fontSize: 56,
    minFontSize: 36,
    maxHeight: H * 0.3,
    lineHeight: 1.3,
  });

  drawCornerLogo(ctx, logo);
  return canvas.toBuffer('image/png');
}

function renderSignSlide(content: SlideContent, idx: 0 | 1 | 2, logo: Image | null): Buffer {
  const sign = content.signs[idx];
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_BLACK);
  leftRedBorder(ctx);

  // Number top-left.
  ctx.fillStyle = COLOR_RED;
  ctx.font = `bold 180px Oswald`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`${idx + 1}.`, PAD + 30, PAD + 40);

  drawWrappedText(ctx, {
    text: sign.title,
    cy: H * 0.5,
    fontSize: 88,
    minFontSize: 56,
    maxHeight: H * 0.25,
  });

  drawWrappedText(ctx, {
    text: sign.detail,
    cy: H * 0.72,
    fontSize: 50,
    minFontSize: 34,
    opacity: 0.7,
    maxHeight: H * 0.25,
    lineHeight: 1.3,
  });

  drawCornerLogo(ctx, logo);
  return canvas.toBuffer('image/png');
}

function renderSlide6Example(content: SlideContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_PURPLE);

  // Decorative giant quote marks behind.
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = COLOR_RED;
  ctx.font = `bold 600px Oswald`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('"', 40, 80);
  ctx.textAlign = 'right';
  ctx.fillText('"', W - 40, H - 700);
  ctx.restore();

  drawWrappedText(ctx, {
    text: 'SOUND FAMILIAR?',
    cy: H * 0.18,
    fontSize: 52,
    color: COLOR_RED,
    letterSpacingTracked: 6,
  });

  drawWrappedText(ctx, {
    text: content.example,
    cy: H * 0.52,
    fontSize: 62,
    minFontSize: 40,
    italic: true,
    maxHeight: H * 0.5,
    lineHeight: 1.35,
  });

  drawCornerLogo(ctx, logo);
  return canvas.toBuffer('image/png');
}

function renderSlide7Protection(content: SlideContent, logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillBg(ctx, COLOR_BLACK);

  drawWrappedText(ctx, {
    text: 'PROTECT YOURSELF',
    cy: H * 0.18,
    fontSize: 52,
    color: COLOR_RED,
    letterSpacingTracked: 6,
  });

  drawWrappedText(ctx, {
    text: content.protectionTip,
    cy: H * 0.5,
    fontSize: 78,
    minFontSize: 48,
    maxHeight: H * 0.45,
    lineHeight: 1.25,
  });

  // Simple geometric shield silhouette near bottom.
  ctx.save();
  ctx.strokeStyle = COLOR_RED;
  ctx.lineWidth = 6;
  const sx = W / 2;
  const sy = H * 0.82;
  const sw = 120;
  const sh = 150;
  ctx.beginPath();
  ctx.moveTo(sx - sw / 2, sy);
  ctx.lineTo(sx + sw / 2, sy);
  ctx.lineTo(sx + sw / 2, sy + sh * 0.55);
  ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh);
  ctx.quadraticCurveTo(sx, sy + sh, sx - sw / 2, sy + sh * 0.55);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  drawCornerLogo(ctx, logo);
  return canvas.toBuffer('image/png');
}

function renderSlide8Cta(logo: Image | null): Buffer {
  const { canvas, ctx } = newCanvas();
  fillVerticalGradient(ctx, COLOR_BLACK, COLOR_PURPLE);

  // Hero logo center, 200x200 at y=600 (per spec)
  drawLogo(ctx, logo, (W - 200) / 2, 600, 200);

  drawWrappedText(ctx, {
    text: 'MIND SHIELD DAILY',
    cy: 870,
    fontSize: 52,
    minFontSize: 44,
    color: COLOR_WHITE,
    maxHeight: H * 0.1,
  });

  drawWrappedText(ctx, {
    text: '@mindshieldaily',
    cy: 950,
    fontSize: 36,
    minFontSize: 30,
    color: COLOR_RED,
    maxHeight: H * 0.08,
  });

  drawWrappedText(ctx, {
    text: '🖤 New drop every day',
    cy: 1030,
    fontSize: 32,
    color: COLOR_WHITE,
    opacity: 0.6,
    maxHeight: H * 0.08,
  });

  return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function generateCarousel(script: ScriptWithTopic): Promise<string[]> {
  ensureFont();
  await fs.ensureDir(CAROUSEL_DIR);

  const [content, logo] = await Promise.all([
    extractSlideContent(script),
    getLogo(),
  ]);

  // Build series info for slide 1 if this script belongs to a series
  let seriesInfo: SeriesSlideInfo | undefined;
  if (script.series_id && script.episode_number) {
    const { ACTIVE_ACCOUNT: acct } = await import('../config/accounts');
    const seriesCfg = acct.series.find((s) => s.id === script.series_id);
    if (seriesCfg) {
      seriesInfo = { seriesName: seriesCfg.name, episodeNumber: script.episode_number };
    }
  }

  const slides: Array<[number, Buffer]> = [
    [1, renderSlide1Hook(content, logo, seriesInfo)],
    [2, renderSlide2Concept(content, logo)],
    [3, renderSignSlide(content, 0, logo)],
    [4, renderSignSlide(content, 1, logo)],
    [5, renderSignSlide(content, 2, logo)],
    [6, renderSlide6Example(content, logo)],
    [7, renderSlide7Protection(content, logo)],
    [8, renderSlide8Cta(logo)],
  ];

  const paths: string[] = [];
  for (const [n, buf] of slides) {
    const out = path.join(CAROUSEL_DIR, `script_${script.id}_slide_${n}.png`);
    await fs.writeFile(out, buf);
    paths.push(out);
  }

  await writeCarouselGuide(script, paths);

  return paths;
}

function buildGuide(script: ScriptWithTopic, slidePaths: string[]): string {
  return [
    '╔══════════════════════════════════════════╗',
    `║   TIKTOK CAROUSEL — Script #${String(script.id).padEnd(12)}║`,
    '╠══════════════════════════════════════════╣',
    '║ UPLOAD TYPE: Photo Post (not video)      ║',
    '║                                          ║',
    '║ SLIDES (upload in order):                ║',
    ...slidePaths.map((p) => `║  ${path.basename(p).padEnd(40)}║`),
    '╠══════════════════════════════════════════╣',
    `║ CAPTION: ${(script.caption ?? '').slice(0, 32).padEnd(32)}║`,
    `║ HASHTAGS: ${(script.hashtags ?? '').slice(0, 31).padEnd(31)}║`,
    '╠══════════════════════════════════════════╣',
    '║ 🎵 MUSIC TIP: Add trending sound         ║',
    '║ Photo posts support background music     ║',
    '║ Search: "dark ambient" or "thriller"     ║',
    '╚══════════════════════════════════════════╝',
    '',
    'FULL SLIDE PATHS:',
    ...slidePaths.map((p) => `  ${p}`),
    '',
    'FULL CAPTION (copy exactly):',
    script.caption ?? '',
    '',
    'FULL HASHTAGS (copy exactly):',
    script.hashtags ?? '',
    '',
  ].join('\n');
}

async function writeCarouselGuide(script: ScriptWithTopic, slidePaths: string[]): Promise<void> {
  await fs.ensureDir(READY_DIR);
  const guidePath = path.join(READY_DIR, `script_${script.id}_carousel.txt`);
  await fs.writeFile(guidePath, buildGuide(script, slidePaths), 'utf8');
  log.info(`  📂 Carousel guide: ${guidePath}`);
}

async function listScriptsNeedingCarousel(): Promise<ScriptWithTopic[]> {
  const all = getAllScripts();
  // Group by topic_id+platform, keep only tiktok rows to avoid duplicate carousels per topic.
  const tiktokScripts = all.filter((s) => s.platform === 'tiktok');
  const out: ScriptWithTopic[] = [];
  for (const s of tiktokScripts) {
    const slide1 = path.join(CAROUSEL_DIR, `script_${s.id}_slide_1.png`);
    if (!(await fs.pathExists(slide1))) out.push(s);
  }
  return out;
}

export interface RunCarouselOpts {
  onlyIds?: number[];
  force?: boolean;
}

export async function runCarousel(opts: RunCarouselOpts = {}): Promise<number[]> {
  await fs.ensureDir(CAROUSEL_DIR);

  let targets: ScriptWithTopic[];
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    targets = getScriptsByIds(opts.onlyIds);
  } else {
    targets = await listScriptsNeedingCarousel();
  }

  if (targets.length === 0) {
    log.warn('No scripts need a carousel.');
    return [];
  }

  if (!opts.force && !opts.onlyIds) {
    log.info(`🖼️  ${targets.length} script(s) without carousels.`);
  }

  const produced: number[] = [];
  for (const s of targets) {
    const slide1 = path.join(CAROUSEL_DIR, `script_${s.id}_slide_1.png`);
    if (!opts.force && (await fs.pathExists(slide1))) {
      log.info(`  ✓ script ${s.id} already has carousel — skipping`);
      continue;
    }
    try {
      log.info(`🖼️  Generating carousel for script ${s.id} — ${s.topic_title}`);
      const paths = await generateCarousel(s);
      log.success(`✅ ${paths.length} slides saved to ${CAROUSEL_DIR}`);
      produced.push(s.id);
    } catch (err) {
      log.error(`  carousel failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return produced;
}
