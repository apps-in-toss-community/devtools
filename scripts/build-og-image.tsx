/**
 * build-og-image.tsx
 *
 * Generates the single static Open Graph PNG (1200x630) for the @ait-co/devtools
 * npm landing. Output: assets/og/image.png.
 *
 * Pipeline: JSX template (scripts/og/template.tsx) -> satori -> SVG -> sharp -> PNG.
 *
 * Runs as part of `prepublishOnly` so the committed PNG always reflects the
 * current template. The PNG is committed (single file, ~15-20KB) and consumed
 * by README hero image + GitHub social preview; npm publish payload excludes
 * the `assets/` directory via package.json `files`.
 *
 * If you change the template, copy, or fonts: rerun `pnpm build:og` and commit
 * the regenerated `assets/og/image.png` in the same change. Otherwise GitHub
 * (which serves the committed PNG) drifts behind the template until the next
 * publish.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { OgTemplate } from './og/template';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'assets/og');
const OUT_FILE = resolve(OUT_DIR, 'image.png');
const FONTS_DIR = resolve(__dirname, 'og/fonts');

const OG = {
  eyebrow: 'Open Source Community',
  title: '@ait-co/devtools',
  subtitle: 'mock SDK + DevTools panel for Apps in Toss mini-apps.',
  footer: 'aitc.dev · npmjs.com/package/@ait-co/devtools',
};

async function loadFonts(): Promise<Parameters<typeof satori>[1]['fonts']> {
  const [bold, semibold, medium] = await Promise.all([
    readFile(resolve(FONTS_DIR, 'Pretendard-Bold.otf')),
    readFile(resolve(FONTS_DIR, 'Pretendard-SemiBold.otf')),
    readFile(resolve(FONTS_DIR, 'Pretendard-Medium.otf')),
  ]);
  return [
    { name: 'Pretendard', data: medium, weight: 500, style: 'normal' },
    { name: 'Pretendard', data: semibold, weight: 600, style: 'normal' },
    { name: 'Pretendard', data: bold, weight: 800, style: 'normal' },
  ];
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const fonts = await loadFonts();

  console.log('[og] generating image...');
  const start = Date.now();

  const svg = await satori(
    <OgTemplate eyebrow={OG.eyebrow} title={OG.title} subtitle={OG.subtitle} footer={OG.footer} />,
    { width: 1200, height: 630, fonts },
  );
  // palette: true switches to 8-bit colormap PNG, ~3x smaller for the limited
  // palette (brand blue, grays, white). quality controls quantization on top.
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
  await writeFile(OUT_FILE, png);

  console.log(`[og]  -> assets/og/image.png (${Date.now() - start}ms)`);
}

main().catch((err) => {
  console.error('[og] failed:', err);
  process.exit(1);
});
