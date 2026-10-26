// Records docs/demo.gif: the web app checking a request, explaining an error and making a live
// demo-key call. Needs the stack running (`npm run stack:up`) and ffmpeg on the PATH.
//
//   node scripts/record-demo.mjs [base-url]
//
// The live step makes one real call to DHL with the public demo-key.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? 'http://localhost:8080';
const out = new URL('../docs/demo.gif', import.meta.url).pathname;
const size = { width: 1280, height: 760 };
const videoDir = mkdtempSync(join(tmpdir(), 'demo-video-'));

// Video capture has no mouse pointer, so the page draws one that follows the mouse.
const cursor = () => {
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;'
      + 'background:rgba(15,118,110,.35);border:2px solid #0f766e;pointer-events:none;left:-40px;top:-40px;transition:transform .1s';
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
  });
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, colorScheme: 'light', recordVideo: { dir: videoDir, size } });
await context.addInitScript(cursor);
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

/** Glides the pointer to an element, then clicks it, so viewers can follow. */
async function click(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await pause(250);
  await locator.click();
}

await page.goto(baseUrl);
await page.mouse.move(640, 300);
await pause(1200);

// 1. Check a request: an ISO date, a long address line, a lowercase country code.
await click(page.getByRole('button', { name: 'MyDHL shipment with an ISO date' }));
await pause(2500);
await page.getByRole('region', { name: 'Findings' }).getByRole('listitem').nth(2).hover();
await page.mouse.wheel(0, 380);
await pause(2500);
await page.mouse.wheel(0, -380);
await pause(600);

// 2. Explain an error: MyDHL's 998.
await click(page.getByRole('tab', { name: 'Explain an error' }));
await pause(600);
await click(page.getByRole('button', { name: 'MyDHL: 998 date format' }));
await pause(3500);

// 3. Live call with the demo-key.
await click(page.getByRole('tab', { name: 'Live demo-key call' }));
await pause(600);
await click(page.getByRole('button', { name: 'Call DHL' }));
await page.getByText(/^HTTP \d+$/).waitFor({ timeout: 20_000 });
await pause(3500);

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();

// Two passes: build a palette from the whole clip, then dither with it. 880 px wide at 10 fps
// keeps the text readable and the file small.
const filters = 'fps=10,scale=880:-1:flags=lanczos';
const palette = join(videoDir, 'palette.png');
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-i', palette,
  '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, out]);
rmSync(videoDir, { recursive: true, force: true });
process.stdout.write(`Wrote ${out}\n`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed`);
}
