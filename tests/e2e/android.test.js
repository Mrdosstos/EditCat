// The Android app injects window.EditCatAndroid; this checks the page uses it to save exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', '..', 'dist');
let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(DIST, 'editcat.html')).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => { await browser?.close(); server?.close(); });

const fakeBridge = () => {
  window.__bridge = { calls: [], bytes: 0, chunks: [], awake: [] };
  const B = window.__bridge;
  window.EditCatAndroid = {
    version: () => '1',
    begin(name, mime) { B.calls.push(['begin', name, mime]); B.chunks = []; return true; },
    append(b64) { B.calls.push(['append']); B.chunks.push(b64); B.bytes += atob(b64).length; return true; },
    finish() { B.calls.push(['finish']); return 'Downloads/EditCat/' + B.calls[0][1]; },
    abort() { B.calls.push(['abort']); },
    shareLast() { B.calls.push(['share']); },
    keepAwake(on) { B.awake.push(on); },
  };
};

test('no app Android, salvar o vídeo exportado passa pela ponte nativa, em pedaços, sem perder bytes', async () => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '#exemplo');
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready, null, { timeout: 15000 });
  await page.evaluate(() => { const P = window.__editcat.project; P.clips = P.clips.slice(0, 1); P.clips[0].out = 1.2; P.texts = []; P.audios[0].out = 1.2; });
  await page.click('#exportBtn');
  await page.click('#expGo');
  await page.waitForSelector('#expDone:not([hidden])', { timeout: 20000 });
  assert.equal(await page.isHidden('#expShare'), true);
  await page.click('#expSave');
  await page.waitForFunction(() => window.__bridge.calls.some(c => c[0] === 'finish'), null, { timeout: 10000 });
  const r = await page.evaluate(() => ({ B: window.__bridge, size: window.__editcat.lastExport.blob.size, type: window.__editcat.lastExport.blob.type }));
  assert.equal(r.B.calls[0][0], 'begin');
  assert.match(r.B.calls[0][1], /^Exemplo-primeiro-corte\.(mp4|webm)$/);
  assert.equal(r.B.calls[0][2], r.type);
  assert.equal(r.B.bytes, r.size, 'todos os bytes chegaram ao Android');
  assert.deepEqual(r.B.awake, [true, false], 'tela acesa só durante a exportação');
  // the bytes are identical, not just the same count
  const same = await page.evaluate(async () => {
    const buf = new Uint8Array(await window.__editcat.lastExport.blob.arrayBuffer());
    const got = Uint8Array.from(window.__bridge.chunks.map(c => atob(c)).join(''), ch => ch.charCodeAt(0));
    return got.length === buf.length && got.every((v, i) => v === buf[i]);
  });
  assert.ok(same);
  await page.waitForSelector('#expShare:not([hidden])');
  await page.click('#expShare');
  assert.ok((await page.evaluate(() => window.__bridge.calls.map(c => c[0]))).includes('share'));
  assert.match(await page.textContent('#toast'), /Salvo em Downloads\/EditCat\//);
  assert.deepEqual(errors, []);
  await context.close();
});

test('se o Android não conseguir gravar, a página cancela e avisa', async () => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(fakeBridge);
  await context.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => { window.EditCatAndroid.append = () => false; }); });
  const page = await context.newPage();
  await page.goto(base + '#exemplo');
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready, null, { timeout: 15000 });
  await page.evaluate(() => { const P = window.__editcat.project; P.clips = P.clips.slice(0, 1); P.clips[0].out = 1; P.texts = []; P.audios[0].out = 1; });
  await page.click('#exportBtn'); await page.click('#expGo');
  await page.waitForSelector('#expDone:not([hidden])', { timeout: 20000 });
  await page.click('#expSave');
  await page.waitForFunction(() => window.__bridge.calls.some(c => c[0] === 'abort'), null, { timeout: 10000 });
  assert.match(await page.textContent('#toast'), /Não foi possível salvar/);
  assert.equal(await page.isHidden('#expShare'), true);
  assert.equal(await page.isEnabled('#expSave'), true);
  await context.close();
});
