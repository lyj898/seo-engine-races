// Turn rendered carousel slides into 9:16 Reels (MP4).
//
//   FFMPEG=path/to/ffmpeg node scripts/social/reels.js <folder> <post-prefix> [<post-prefix> ...]
//
// <folder> is a runsea-social week folder (slides as <prefix>-01.png, -02.png ...).
// Each slide is placed on a 1080x1920 canvas whose top and bottom bands continue
// the slide's own edge colours, the carousel dots and "swipe" are painted out,
// and the slides play in order with a slow zoom and a short crossfade. The
// track is silent: add music in the Instagram app if wanted. Output goes to
// <folder>/reels/<prefix>.mp4. ffmpeg isn't a project dependency, so pass its
// path in FFMPEG (e.g. from a one-off `npm i ffmpeg-static` outside the repo).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const [folder, ...prefixes] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG;
if (!folder || !prefixes.length || !FFMPEG) {
  console.error('usage: FFMPEG=path node scripts/social/reels.js <folder> <post-prefix> [...]');
  process.exit(1);
}
const W = 1080, H = 1920, SH = 1350, BAND = (H - SH) / 2;
const FIRST = 2.8, EACH = 3.6, FADE = 0.4, ZOOM = 0.035;

// A strip of the slide stretched (and softened) to fill a band, so the
// slide's colours carry on past its edge without a seam; the blur keeps
// shapes that touch the edge from turning into stripes.
const strip = (src, top, height, toHeight) =>
  sharp(src).extract({ left: 0, top, width: W, height }).resize(W, toHeight, { fit: 'fill' }).blur(14).png().toBuffer();

// One 1080x1920 still per slide. The footer right of the "runsea.run" label
// (dots, "swipe") is covered with tiles of blank footer from the same slide.
async function frame(src, dest) {
  const FOOT = 86, PATCH = { left: 240, width: 130 };
  const patch = await sharp(src).extract({ left: PATCH.left, top: SH - FOOT, width: PATCH.width, height: FOOT }).png().toBuffer();
  const tiles = [];
  for (let x = 380; x < W; x += PATCH.width) tiles.push({ input: patch, left: Math.min(x, W - PATCH.width), top: SH - FOOT });
  const slideImg = await sharp(src).composite(tiles).png().toBuffer();
  const [upper, lower] = await Promise.all([strip(slideImg, 8, 40, BAND), strip(slideImg, SH - 44, 36, BAND)]);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } })
    .composite([{ input: upper, left: 0, top: 0 }, { input: lower, left: 0, top: H - BAND }, { input: slideImg, left: 0, top: BAND }])
    .png().toFile(dest);
}

const outDir = path.join(folder, 'reels');
fs.mkdirSync(outDir, { recursive: true });
for (const prefix of prefixes) {
  const slides = fs.readdirSync(folder).filter((f) => f.startsWith(`${prefix}-`) && /-\d\d\.png$/.test(f)).sort();
  if (!slides.length) { console.error(`no slides for ${prefix}`); continue; }
  const tmp = fs.mkdtempSync(path.join(outDir, '.frames-'));
  const stills = [];
  for (const [i, f] of slides.entries()) {
    const dest = path.join(tmp, `${i}.png`);
    await frame(path.join(folder, f), dest);
    stills.push(dest);
  }
  const dur = stills.map((_, i) => (i === 0 ? FIRST : EACH));
  const args = ['-y'];
  stills.forEach((s, i) => args.push('-loop', '1', '-framerate', '30', '-t', String(dur[i]), '-i', s));
  args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  const parts = stills.map((_, i) =>
    `[${i}:v]scale=w='trunc(${W}*(1+${ZOOM}*t/${dur[i]})/2)*2':h=-2:eval=frame,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}]`);
  let last = 'v0', offset = 0;
  for (let i = 1; i < stills.length; i++) {
    offset += dur[i - 1] - FADE;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[x${i}]`);
    last = `x${i}`;
  }
  const total = dur.reduce((a, b) => a + b, 0) - FADE * (stills.length - 1);
  const out = path.join(outDir, `${prefix}.mp4`);
  args.push('-filter_complex', parts.join(';'), '-map', `[${last}]`, '-map', `${stills.length}:a`,
    '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${prefix}: ${slides.length} slides, ${total.toFixed(1)}s -> ${out}`);
}
