// Phone layout: tool strip, bottom sheets, centre playhead scrubbing, long-press move and pinch zoom (real touch events via CDP).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const DIST = path.join(__dirname, '..', '..', 'dist');
let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(DIST, 'editcat.html')).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + '#exemplo');
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready, null, { timeout: 15000 });
  const cdp = await context.newCDPSession(page);
  return { page, context, errors, cdp };
}
const E = (page, fn, arg) => page.evaluate(fn, arg);
const toolIds = page => page.$$eval('#toolbar [data-tool]', bs => bs.map(b => b.dataset.tool));
const sheetOpen = page => page.$eval('#sheet', el => el.classList.contains('open'));
const touch = (cdp, type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

test('barra principal tem todas as ferramentas e cada uma abre o painel certo', async () => {
  const { page, context, errors } = await open();
  assert.deepEqual(await toolIds(page), ['midia', 'split', 'audio', 'text', 'legendas', 'camada', 'ia', 'rec', 'esconder', 'formato', 'fundo']);
  const expect = {
    midia: ['.mediaList .mitem', 'label[for="fileIn"]'], audio: ['label[for="audioIn"]', '[data-act="rec"]'], legendas: ['[data-act="autocap"]', '#f_script'],
    camada: ['label[for="layerIn"]', '.mediaList [data-add="layer"]'], ia: ['[data-act="silall"]', '[data-act="fitbeats"]', '#f_duck'], esconder: ['[data-act="mosaicbox"]'],
    formato: ['[data-chips="aspect"]'], fundo: ['#f_bg'],
  };
  for (const [t, sels] of Object.entries(expect)) {
    await page.tap(`#toolbar [data-tool="${t}"]`);
    assert.ok(await sheetOpen(page), 'painel aberto: ' + t);
    for (const s of sels) assert.ok(await page.locator('#insp ' + s).first().isVisible(), `${t}: ${s}`);
    await page.tap('#sheetDone');
    await page.waitForTimeout(60);
    assert.equal(await sheetOpen(page), false);
  }
  // a format chosen in the sheet changes the canvas
  await page.tap('#toolbar [data-tool="formato"]');
  await page.tap('#insp [data-chips="aspect"] [data-v="1:1"]');
  assert.deepEqual(await E(page, () => [document.getElementById('cv').width, document.getElementById('cv').height]), [720, 720]);
  // tapping the dimmed area closes the sheet
  await page.mouse.click(200, 80);
  assert.equal(await sheetOpen(page), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('tocar num item troca a barra pelas ferramentas dele; voltar restaura', async () => {
  const { page, context, errors } = await open();
  await page.tap('.vclip >> nth=0');
  assert.deepEqual(await toolIds(page), ['back', 'split', 'vel', 'anim', 'filtros', 'ajustes', 'enq', 'mov', 'freeze', 'dup', 'del']);
  await page.tap('#toolbar [data-tool="filtros"]');
  assert.equal(await page.textContent('#sheetTitle'), 'Filtros');
  assert.equal(await page.locator('#insp .grp').count(), 1, 'só a seção da ferramenta');
  await page.tap('#insp [data-filter="mono"]');
  assert.equal((await E(page, () => window.__editcat.project)).clips[0].filter, 'mono');
  await page.tap('#sheetDone');
  await page.tap('#toolbar [data-tool="vel"]');
  assert.ok(await page.locator('#insp #f_idur').isVisible(), 'foto/clipe animado mostra duração');
  await page.tap('#sheetDone');
  // text, caption-less audio, layer: each gets its own strip
  await page.tap('.tclip >> nth=0');
  assert.deepEqual(await toolIds(page), ['back', 'texto', 'estilo', 'tanim', 'split', 'dup', 'del']);
  await page.tap('.aclip >> nth=0');
  assert.deepEqual(await toolIds(page), ['back', 'split', 'amix', 'afx', 'atipo', 'beats', 'normalize', 'dup', 'del']);
  await page.tap('#toolbar [data-tool="afx"]');
  await page.tap('#insp [data-chips="fx"] [data-v="robo"]');
  assert.equal((await E(page, () => window.__editcat.project)).audios[0].fx, 'robo');
  await page.tap('#sheetDone');
  await page.tap('#backBtn');
  assert.equal(await E(page, () => window.__editcat.selection), null);
  assert.equal((await toolIds(page))[0], 'midia');
  // censor and layer strips
  await page.tap('#toolbar [data-tool="esconder"]'); await page.tap('#insp [data-act="blurbox"]');
  assert.deepEqual(await toolIds(page), ['back', 'split', 'censor', 'mov', 'dup', 'del']);
  await E(page, () => { const P = window.__editcat.project; window.__editcat.select('overlay', P.overlays[0].id); });
  await page.tap('#backBtn');
  await page.tap('#toolbar [data-tool="camada"]');
  await page.tap('#insp .mediaList [data-add="layer"] >> nth=0');
  assert.equal(await sheetOpen(page), false, 'painel fecha depois de adicionar');
  assert.deepEqual(await toolIds(page), ['back', 'split', 'mascara', 'chroma', 'mistura', 'filtros', 'ajustes', 'mov', 'tempo', 'tomain', 'dup', 'del']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('arrastar a linha do tempo move o cursor; tocar reproduz e a linha acompanha', async () => {
  const { page, context, errors, cdp } = await open();
  const box = await page.locator('#tlScroll').boundingBox();
  const y = box.y + box.height - 30, x0 = box.x + box.width * .8;
  await touch(cdp, 'touchStart', [[x0, y]]);
  for (let i = 1; i <= 8; i++) await touch(cdp, 'touchMove', [[x0 - i * 25, y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(400);
  const t = await E(page, () => window.__editcat.time);
  const pps = await E(page, () => document.getElementById('tlScroll').scrollLeft / window.__editcat.time);
  assert.ok(t > 1, 'cursor andou: ' + t);
  assert.ok(Math.abs(pps - 70) < 1, 'cursor = rolagem / zoom');
  await page.tap('#playBtn');
  await page.waitForTimeout(600);
  await page.tap('#playBtn');
  const [t2, sl] = await E(page, () => [window.__editcat.time, document.getElementById('tlScroll').scrollLeft]);
  assert.ok(t2 > t + .3, 'reproduziu');
  assert.ok(Math.abs(sl - t2 * 70) < 3, 'linha do tempo acompanhou o cursor');
  // the playhead sits in the middle of the timeline
  const ph = await page.locator('#playhead').boundingBox();
  assert.ok(Math.abs(ph.x + ph.width / 2 - (box.x + box.width / 2)) < 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('toque longo levanta o clipe e permite mudar a ordem; pinça muda o zoom', async () => {
  const { page, context, errors, cdp } = await open();
  await E(page, () => window.__editcat.seek(0));
  await page.waitForTimeout(100);
  const first = await page.locator('.vclip >> nth=0').boundingBox();
  const ids0 = (await E(page, () => window.__editcat.project)).clips.map(c => c.id);
  const sx = first.x + 30, sy = first.y + first.height / 2;
  await touch(cdp, 'touchStart', [[sx, sy]]);
  await page.waitForTimeout(550);
  assert.equal(await page.locator('.vclip.lifted').count(), 1, 'clipe levantado');
  for (let i = 1; i <= 10; i++) await touch(cdp, 'touchMove', [[sx + i * 30, sy]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  const ids1 = (await E(page, () => window.__editcat.project)).clips.map(c => c.id);
  assert.notEqual(ids1[0], ids0[0], 'ordem mudou');
  assert.ok(ids1.includes(ids0[0]));
  assert.equal(await E(page, () => window.__editcat.time), 0, 'mover o clipe não rolou a linha do tempo');
  await page.tap('#undoBtn');
  assert.deepEqual((await E(page, () => window.__editcat.project)).clips.map(c => c.id), ids0);
  // pinch out zooms in
  const box = await page.locator('#tlScroll').boundingBox(), cy = box.y + box.height - 30, cx = box.x + box.width / 2;
  const w0 = await page.locator('.vclip >> nth=0').evaluate(el => el.offsetWidth);
  await touch(cdp, 'touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [[cx - 40 - i * 15, cy], [cx + 40 + i * 15, cy]]);
  await touch(cdp, 'touchEnd', []);
  const w1 = await page.locator('.vclip >> nth=0').evaluate(el => el.offsetWidth);
  assert.ok(w1 > w0 * 1.8, `zoom: ${w0} → ${w1}`);
  // a quick tap selects without lifting
  const b2 = await page.locator('.tclip >> nth=0').boundingBox();
  await page.touchscreen.tap(b2.x + 10, b2.y + b2.height / 2);
  assert.equal((await E(page, () => window.__editcat.selection)).type, 'text');
  assert.deepEqual(errors, []);
  await context.close();
});

test('no celular a tela inteira cabe sem rolar a página', async () => {
  const { page, context } = await open();
  const r = await E(page, () => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  assert.ok(r.sw <= r.cw, 'sem rolagem lateral'); assert.ok(r.sh <= r.ch + 1, 'sem rolagem vertical');
  const tb = await page.locator('#toolbar').boundingBox(), vp = page.viewportSize();
  assert.ok(Math.abs(tb.y + tb.height - vp.height) < 2, 'barra de ferramentas no rodapé');
  await context.close();
});
