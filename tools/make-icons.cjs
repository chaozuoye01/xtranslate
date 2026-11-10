// Draws the extension icon in the zuoye.si line style and renders the PNG sizes with the test browser.
// Glyph: an orange speech-bubble outline holding the original line (orange) and its translation (blue),
// drawn on a 32-unit grid with 3-unit round strokes like the zuoye.si tool logos. Outside the bubble
// is transparent, and both colours stay readable on light and dark toolbars.
//   extension/assets/icon.svg   glyph cropped to fill the icon, used by the popup and settings page
//   extension/assets/icon-*.png 16/32/48 fill the canvas; 128 keeps the Web Store's 16 px padding (96 px art)
//   docs/brand/logo.svg         the same glyph on the 32×32 grid of the zuoye.si tool list
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const ORANGE = '#ff5a1f', BLUE = '#1d9bf0';
const STROKE = 'fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
// Bubble 5.5–26.5 × 6.5–21.5 with corner radius 6 and a tail below its lower-left corner.
const BUBBLE = 'M11.5 6.5H20.5A6 6 0 0 1 26.5 12.5V15.5A6 6 0 0 1 20.5 21.5H15.5L10 25.5L11.5 21.5H11.5A6 6 0 0 1 5.5 15.5V12.5A6 6 0 0 1 11.5 6.5Z';
const GLYPH = `<g ${STROKE}><path d="${BUBBLE}" stroke="${ORANGE}"/><path d="M11 12.5h10" stroke="${ORANGE}"/><path d="M11 16.5h6" stroke="${BLUE}"/></g>`;

// With its strokes the glyph spans 4–28 × 5–27, so a 26-unit crop from (3, 3) makes it fill the icon.
// pad widens the crop: the 128 px Web Store icon draws the art in its central 96 px.
const icon = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${3 - pad} ${3 - pad} ${26 + 2 * pad} ${26 + 2 * pad}">${GLYPH}</svg>\n`;
const STORE_PAD = (26 * 128 / 96 - 26) / 2;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${GLYPH}</svg>\n`;

async function main() {
  const write = (file, content) => { const full = path.join(ROOT, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); };
  write('extension/assets/icon.svg', icon());
  write('docs/brand/logo.svg', logo);
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const size of [16, 32, 48, 128]) {
      const svg = icon(size === 128 ? STORE_PAD : 0);
      await page.setContent(`<style>body{margin:0}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
      await page.locator('img').evaluate(img => img.decode());
      await page.locator('img').screenshot({ path: path.join(ROOT, 'extension/assets', `icon-${size}.png`), omitBackground: true });
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
