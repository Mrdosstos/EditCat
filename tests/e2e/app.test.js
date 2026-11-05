// End-to-end tests: run the built standalone page (dist/editcat.html) in Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', '..', 'dist');
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'editcat-fixtures-'));
let server, base, browser;

function makeFixtures() {
  // 2 s test video with a tone, a still image and a 3 s tone
  const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', path.join(FIX, 'clipe.webm'));
  ff('-f', 'lavfi', '-i', 'color=c=0x3366ff:size=400x300', '-frames:v', '1', path.join(FIX, 'foto.png'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', path.join(FIX, 'musica.wav'));
}

test.before(async () => {
  makeFixtures();
  server = http.createServer((req, res) => {
    const f = path.join(DIST, req.url === '/' ? 'editcat.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => { await browser?.close(); server?.close(); fs.rmSync(FIX, { recursive: true, force: true }); });

async function open(opts = {}) {
  const context = opts.context || await browser.newContext(Object.assign({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }, opts.ctx));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready, null, { timeout: 15000 });
  return { page, context, errors };
}
const st = (page, fn) => page.evaluate(fn);

test('abre com o projeto de exemplo, sem erros, e a prévia desenha', async () => {
  const { page, context, errors } = await open();
  const P = await st(page, () => window.__editcat.project);
  assert.equal(P.clips.length, 3);
  assert.equal(P.texts.length, 3);
  assert.equal(P.audios.length, 1);
  assert.equal(await page.locator('.vclip').count(), 3);
  assert.equal(await page.locator('.tclip').count(), 3);
  assert.equal(await page.locator('.aclip').count(), 1);
  await page.waitForTimeout(200);
  const px = await st(page, () => window.__editcat.pixel(360, 300));
  assert.ok(px[0] + px[1] + px[2] > 30, 'canvas não está preto: ' + px);
  assert.deepEqual(errors, []);
  await context.close();
});

test('reproduzir avança o tempo; pausar para; Espaço alterna', async () => {
  const { page, context } = await open();
  await page.click('#playBtn');
  await page.waitForTimeout(700);
  const t1 = await st(page, () => window.__editcat.time);
  assert.ok(t1 > 0.3, 'tempo avançou: ' + t1);
  await page.click('#playBtn');
  const t2 = await st(page, () => window.__editcat.time);
  await page.waitForTimeout(300);
  assert.equal(await st(page, () => window.__editcat.time), t2);
  await page.keyboard.press('Space');
  assert.equal(await st(page, () => window.__editcat.playing), true);
  await page.keyboard.press('Space');
  assert.equal(await st(page, () => window.__editcat.playing), false);
  await context.close();
});

test('dividir, desfazer e refazer pela barra', async () => {
  const { page, context } = await open();
  await st(page, () => window.__editcat.seek(1.5));
  await page.click('#splitBtn');
  assert.equal(await page.locator('.vclip').count(), 4);
  const P = await st(page, () => window.__editcat.project);
  assert.ok(Math.abs(P.clips[0].out - 1.5) < 1e-6);
  await page.click('#undoBtn');
  assert.equal(await page.locator('.vclip').count(), 3);
  await page.click('#redoBtn');
  assert.equal(await page.locator('.vclip').count(), 4);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.vclip').count(), 3);
  await context.close();
});

test('selecionar clipe abre ajustes; filtro e velocidade mudam o projeto; Delete exclui', async () => {
  const { page, context } = await open();
  await page.locator('.vclip').first().click();
  await page.click('[data-chips="trans"] [data-v="wipe"]');
  let P = await st(page, () => window.__editcat.project);
  assert.equal(P.clips[0].trans, 'wipe');
  await page.waitForSelector('.insp .fgrid');
  await page.click('[data-filter="mono"]');
  P = await st(page, () => window.__editcat.project);
  assert.equal(P.clips[0].filter, 'mono');
  await page.locator('#f_b').fill('1.5');
  P = await st(page, () => window.__editcat.project);
  assert.equal(P.clips[0].b, 1.5);
  await page.locator('.vclip').first().click();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.vclip').count(), 2);
  await context.close();
});

test('adicionar texto, editar conteúdo e arrastar na prévia', async () => {
  const { page, context } = await open();
  await st(page, () => window.__editcat.seek(0.5));
  await page.click('#addTextBtn');
  await page.waitForSelector('#f_text');
  await page.fill('#f_text', 'Teste do EditCat');
  let P = await st(page, () => window.__editcat.project);
  const tx = P.texts[P.texts.length - 1];
  assert.equal(tx.text, 'Teste do EditCat');
  assert.equal(await page.locator('.tclip').count(), 4);
  // drag the new text (centre of canvas) down and right
  await page.waitForTimeout(600); // let the pop animation settle
  const box = await page.locator('#cv').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.2, cy + box.height * 0.2, { steps: 5 }); await page.mouse.up();
  P = await st(page, () => window.__editcat.project);
  const moved = P.texts.find(t => t.id === tx.id);
  assert.ok(moved.x > 0.6 && moved.y > 0.6, `posição ${moved.x},${moved.y}`);
  await context.close();
});

test('trocar formato redimensiona a prévia', async () => {
  const { page, context } = await open();
  await page.click('[data-chips="aspect"] [data-v="16:9"]');
  const size = await page.evaluate(() => [document.getElementById('cv').width, document.getElementById('cv').height]);
  assert.deepEqual(size, [1280, 720]);
  await context.close();
});

test('importar vídeo, foto e música', async () => {
  const { page, context, errors } = await open();
  await page.setInputFiles('#fileIn', [path.join(FIX, 'clipe.webm'), path.join(FIX, 'foto.png'), path.join(FIX, 'musica.wav')]);
  await page.waitForFunction(() => window.__editcat.project.media.length === 7, null, { timeout: 15000 });
  const P = await st(page, () => window.__editcat.project);
  const vid = P.media.find(m => m.kind === 'video');
  assert.ok(Math.abs(vid.duration - 2) < 0.1, 'duração do vídeo ' + vid.duration);
  assert.equal(P.clips.length, 5);
  assert.equal(P.audios.length, 2);
  // seek into the imported video and check the frame is drawn (testsrc is colourful)
  const start = P.clips.slice(0, 3).reduce((a, c) => a + (c.out - c.in) / c.speed, 0);
  await st(page, `window.__editcat.seek(${start + 1})`);
  await page.waitForTimeout(500);
  const px = await st(page, () => window.__editcat.pixel(360, 640));
  assert.ok(px[0] + px[1] + px[2] > 30);
  // media bin shows thumbnails for all items
  assert.equal(await page.locator('.mitem').count(), 7);
  assert.deepEqual(errors, []);
  await context.close();
});

test('o projeto fica salvo depois de recarregar', async () => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const { page } = await open({ context });
  await page.fill('#projName', 'Meu vlog');
  await st(page, () => window.__editcat.seek(1));
  await page.click('#splitBtn');
  await page.waitForTimeout(900); // debounced save
  await page.reload();
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready);
  const P = await st(page, () => window.__editcat.project);
  assert.equal(P.name, 'Meu vlog');
  assert.equal(P.clips.length, 4);
  assert.equal(P.audios.length, 1, 'música do exemplo restaurada do armazenamento');
  // "Novo projeto" needs two clicks
  await page.click('#newBtn');
  assert.equal((await st(page, () => window.__editcat.project)).clips.length, 4);
  await page.click('#newBtn');
  assert.equal((await st(page, () => window.__editcat.project)).clips.length, 0);
  await page.click('#undoBtn');
  assert.equal((await st(page, () => window.__editcat.project)).clips.length, 4);
  await context.close();
});

test('exportar gera um vídeo com imagem e som e oferece para salvar', async () => {
  const { page, context, errors } = await open();
  // shorten the project so the real-time export is quick
  await page.evaluate(() => { const P = window.__editcat.project; P.clips = P.clips.slice(0, 1); P.clips[0].out = 1.5; P.texts = P.texts.slice(0, 1); P.texts[0].dur = 1.2; P.audios[0].out = 1.5; window.__editcat.select('clip', P.clips[0].id); });
  await page.click('#exportBtn');
  await page.waitForSelector('#expSetup:not([hidden])');
  assert.match(await page.textContent('#expSpec'), /720×1280 · 30 fps · (MP4|WebM)/);
  await page.click('#expGo');
  await page.waitForSelector('#expDone:not([hidden])', { timeout: 20000 });
  const info = await page.evaluate(() => ({ size: window.__editcat.lastExport.blob.size, type: window.__editcat.lastExport.blob.type }));
  assert.ok(info.size > 10000, 'tamanho ' + info.size);
  assert.match(info.type, /^video\/(mp4|webm)$/);
  // the recorded file decodes and has both video and audio
  const meta = await page.evaluate(async () => {
    const v = document.getElementById('expVideo');
    if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
    return { w: v.videoWidth, h: v.videoHeight };
  });
  assert.deepEqual(meta, { w: 720, h: 1280 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expSave')]);
  assert.match(dl.suggestedFilename(), /^Exemplo-primeiro-corte\.(mp4|webm)$/);
  const file = path.join(FIX, dl.suggestedFilename()); await dl.saveAs(file);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
  assert.match(probe, /video/); assert.match(probe, /audio/);
  // editor goes back to preview quality and restores the selection
  assert.equal(await page.evaluate(() => document.getElementById('cv').width), 720);
  assert.equal(await st(page, () => window.__editcat.selection?.type), 'clip');
  assert.deepEqual(errors, []);
  await context.close();
});

test('no celular a página não rola para os lados e os controles aparecem', async () => {
  const { page, context, errors } = await open({ ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'overflow horizontal: ' + over);
  for (const sel of ['#playBtn', '#exportBtn', '#splitBtn', '#addTextBtn']) assert.ok(await page.locator(sel).isVisible(), sel);
  await page.tap('#playBtn');
  await page.waitForTimeout(400);
  assert.ok(await st(page, () => window.__editcat.time) > 0.1);
  assert.deepEqual(errors, []);
  await context.close();
});
