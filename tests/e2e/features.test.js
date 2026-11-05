// Browser tests for layers, keyframes, audio tools, captions, voice effects, freeze/reverse, censor and narration.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', '..', 'dist');
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'editcat-feat-'));
let server, base, browser;

test.before(async () => {
  const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
  // 4 s video: tone 0–1 s, silence 1–2.5 s, tone 2.5–4 s
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=4', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,1)+gt(t,2.5),0.5*sin(2*PI*300*t),0)':s=48000:d=4",
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', path.join(FIX, 'fala.webm'));
  // green screen with a red square in the middle
  // 20 s: still grey picture and silence, except action (moving picture + tone) at 6–10 s and 14–18 s
  ff('-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=6', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=4',
    '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,6,10)+between(t,14,18),0.5*sin(2*PI*300*t),0)':s=48000:d=20",
    '-filter_complex', '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v]', '-map', '[v]', '-map', '5:a', '-c:v', 'libvpx', '-b:v', '400k', '-c:a', 'libopus', path.join(FIX, 'acao.webm'));
  // 10 s with sound only in the first second
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=10', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,1),0.5*sin(2*PI*300*t),0)':s=48000:d=10",
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-shortest', path.join(FIX, 'pouco.webm'));
  ff('-f', 'lavfi', '-i', 'color=c=0x00ff00:size=400x400', '-vf', 'drawbox=x=150:y=150:w=100:h=100:color=red:t=fill', '-frames:v', '1', path.join(FIX, 'verde.png'));
  server = http.createServer((req, res) => {
    const f = path.join(DIST, req.url === '/' ? 'editcat.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
test.after(async () => { await browser?.close(); server?.close(); fs.rmSync(FIX, { recursive: true, force: true }); });

async function open(hash = '#exemplo') {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + hash);
  await page.waitForFunction(() => window.__editcat && window.__editcat.ready, null, { timeout: 15000 });
  return { page, context, errors };
}
const P = page => page.evaluate(() => window.__editcat.project);
async function importFile(page, name) {
  const before = (await P(page)).media.length;
  await page.setInputFiles('#fileIn', path.join(FIX, name));
  await page.waitForFunction(n => window.__editcat.project.media.length > n, before, { timeout: 15000 });
  const p = await P(page);
  return p.media[p.media.length - 1];
}
const pixel = (page, x, y) => page.evaluate(([x, y]) => window.__editcat.pixel(x, y), [x, y]);
const isGreen = p => p[1] > 200 && p[0] < 60 && p[2] < 60;

test('camada com chroma key, máscara e modo de mistura', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'verde.png');
  await page.evaluate(() => window.__editcat.seek(1));
  await page.click(`[data-add="layer"][data-mid="${m.id}"]`);
  let p = await P(page);
  assert.equal(p.overlays.length, 1);
  assert.equal(await page.locator('.oclip').count(), 1);
  // overlay is 50% of the 720 px frame width => 360 px square centred at (360,640); green ring around a red centre
  await page.waitForTimeout(150);
  assert.ok(isGreen(await pixel(page, 360 - 140, 640)), 'camada verde visível');
  assert.deepEqual((await pixel(page, 360, 640)).slice(0, 3).map(v => v > 200), [true, false, false], 'centro vermelho');
  await page.check('#f_chon');
  await page.waitForTimeout(100);
  assert.ok(!isGreen(await pixel(page, 360 - 140, 640)), 'verde removido pelo chroma key');
  assert.ok((await pixel(page, 360, 640))[0] > 200, 'vermelho continua');
  // circular mask small enough to hide the corners of the layer
  await page.click('[data-chips="mask"] [data-v="circle"]');
  await page.locator('#f_msize').fill('0.4');
  await page.uncheck('#f_chon');
  await page.waitForTimeout(100);
  assert.ok(!isGreen(await pixel(page, 360 - 170, 640 - 170)), 'canto escondido pela máscara');
  assert.ok((await pixel(page, 360, 640))[0] > 200);
  await page.click('[data-chips="blend"] [data-v="multiply"]');
  p = await P(page);
  assert.equal(p.overlays[0].blend, 'multiply');
  assert.equal(p.overlays[0].mask.type, 'circle');
  assert.deepEqual(errors, []);
  await context.close();
});

test('quadros-chave animam a camada entre duas posições', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'verde.png');
  await page.evaluate(() => window.__editcat.seek(1));
  await page.click(`[data-add="layer"][data-mid="${m.id}"]`);
  await page.locator('#f_mx').fill('0.25');
  await page.click('#kfBtn');
  await page.evaluate(() => window.__editcat.seek(3));
  await page.locator('#f_mx').fill('0.75'); // auto-key, x is already animated
  let o = (await P(page)).overlays[0];
  assert.deepEqual(o.kf.x.map(k => [Math.round(k.t * 100) / 100, k.v]), [[0, .25], [2, .75]]);
  assert.ok(await page.locator('.oclip .kfm').count() >= 2, 'marcas de quadro-chave na linha do tempo');
  // halfway the layer is in the middle: its centre (red) at x≈360
  await page.evaluate(() => window.__editcat.seek(2));
  await page.waitForTimeout(100);
  assert.ok((await pixel(page, 360, 640))[0] > 200, 'meio do caminho');
  await page.evaluate(() => window.__editcat.seek(1));
  await page.waitForTimeout(100);
  assert.ok((await pixel(page, 180, 640))[0] > 200, 'começo à esquerda');
  // K removes the key under the cursor
  await page.locator('.oclip').click();
  await page.evaluate(() => window.__editcat.seek(1));
  await page.keyboard.press('k');
  o = (await P(page)).overlays[0];
  assert.equal(o.kf.x.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('separar áudio, remover silêncios e equalizar volume', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'fala.webm');
  let p = await P(page);
  const vid = p.clips[p.clips.length - 1];
  assert.equal(vid.mediaId, m.id);
  // detach
  await page.locator(`.vclip[data-id="${vid.id}"]`).click();
  await page.click('[data-act="detach"]');
  p = await P(page);
  const a = p.audios.find(x => x.mediaId === m.id);
  assert.ok(a, 'áudio criado'); assert.equal(a.role, 'voz'); assert.equal(p.clips.find(c => c.id === vid.id).volume, 0);
  assert.ok(Math.abs(a.start - 9.2) < 1e-6);
  await page.click('#undoBtn');
  // remove silences (1–2.5 s is silent)
  await page.locator(`.vclip[data-id="${vid.id}"]`).click();
  const before = (await P(page)).clips.length;
  await page.click('[data-act="silence"]');
  p = await P(page);
  assert.equal(p.clips.length, before + 1, 'clipe virou dois pedaços');
  const pieces = p.clips.filter(c => c.mediaId === m.id);
  const kept = pieces.reduce((s, c) => s + c.out - c.in, 0);
  assert.ok(kept > 2.2 && kept < 2.9, 'sobrou ~2,5 s de som: ' + kept);
  // normalise everything
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="normall"]');
  p = await P(page);
  assert.ok(p.clips.filter(c => c.mediaId === m.id).every(c => c.volume > 0.1 && c.volume <= 2));
  assert.match(await page.textContent('#st_norm'), /Volume equalizado/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('legendas a partir do roteiro caem nos trechos com fala; estilo vale para todas', async () => {
  const { page, context, errors } = await open();
  await importFile(page, 'fala.webm');
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.fill('#f_script', 'Primeira parte do vídeo. Agora a segunda parte.');
  await page.click('[data-act="scriptcap"]');
  await page.waitForFunction(() => window.__editcat.project.captions.length === 2, null, { timeout: 10000 });
  const p = await P(page);
  const [c1, c2] = p.captions;
  assert.ok(c1.start >= 9.0 && c1.start + c1.dur <= 10.45, `primeira em ${c1.start}–${c1.start + c1.dur}`);
  assert.ok(c2.start >= 10.4 && c2.start + c2.dur <= 13.3, `segunda em ${c2.start}–${c2.start + c2.dur}`);
  assert.equal(await page.locator('.cclip').count(), 2);
  await page.locator('.cclip').first().click();
  await page.click('[data-chl="#62cfae"]');
  await page.click('[data-chips="cstyle"] [data-v="box"]');
  const st = (await P(page)).capStyle;
  assert.equal(st.hl, '#62cfae'); assert.equal(st.style, 'box');
  // caption is drawn: pixel inside the caption box is dark (box background)
  await page.evaluate(t => window.__editcat.seek(t), c1.start + .3);
  await page.waitForTimeout(100);
  const px = await pixel(page, 360, Math.round(st.y * 1280) - 30);
  assert.ok(px[0] + px[1] + px[2] < 600, 'caixa da legenda desenhada');
  assert.deepEqual(errors, []);
  await context.close();
});

test('legendas automáticas usam o reconhecimento de fala e o tempo de cada palavra', async () => {
  const { page, context, errors } = await open();
  await importFile(page, 'fala.webm');
  const got = await page.evaluate(() => { window.__asrCalls = []; window.__editcatASR = async (samples, sr) => { window.__asrCalls.push({ n: samples.length, sr }); return [{ w: 'Olá', t: 9.3, e: 9.6 }, { w: 'pessoal.', t: 9.65, e: 10.1 }, { w: 'Tudo', t: 11.8, e: 12.1 }, { w: 'certo?', t: 12.15, e: 12.6 }]; }; return true; });
  assert.ok(got);
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="autocap"]');
  await page.waitForFunction(() => window.__editcat.project.captions.length === 2, null, { timeout: 15000 });
  const calls = await page.evaluate(() => window.__asrCalls);
  assert.equal(calls[0].sr, 16000);
  assert.ok(Math.abs(calls[0].n / 16000 - 13.2) < 0.1, 'mandou o áudio da linha do tempo inteira');
  const p = await P(page);
  assert.equal(p.captions[0].text, 'Olá pessoal.'); assert.equal(p.captions[1].text, 'Tudo certo?');
  assert.equal(p.captions[0].words.length, 2);
  assert.match(await page.textContent('#st_cap'), /2 legendas criadas/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('marcar batidas da música e ajustar os clipes ao ritmo', async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="beats"]');
  let p = await P(page);
  assert.ok(p.beats.length >= 12 && p.beats.length <= 16, 'batidas: ' + p.beats.length);
  const gaps = p.beats.slice(1).map((b, i) => b - p.beats[i]);
  const med = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  assert.ok(Math.abs(med - 0.3125) < 0.04 || Math.abs(med - 0.625) < 0.04, 'intervalo ~96 BPM: ' + med);
  assert.ok(await page.locator('.beat').count() === p.beats.length);
  await page.click('[data-act="fitbeats"]');
  p = await P(page);
  let t = 0;
  for (const c of p.clips) { t += (c.out - c.in) / c.speed; assert.ok(p.beats.some(b => Math.abs(b - t) < 1e-3), 'clipe termina numa batida: ' + t); }
  assert.deepEqual(errors, []);
  await context.close();
});

test('efeitos de voz montam a cadeia de áudio; música abaixa quando há fala', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'fala.webm');
  let p = await P(page);
  const music = p.audios[0];
  await page.evaluate(id => { const a = window.__editcat.project.audios.find(x => x.id === id); a.out = 10; a.fadeOut = 0; a.volume = 1; }, music.id);
  await page.locator(`.aclip[data-id="${music.id}"]`).click();
  await page.click('[data-chips="fx"] [data-v="eco"]');
  await page.check('#f_clean');
  await page.evaluate(() => window.__editcat.seek(9.25));
  await page.click('#playBtn');
  await page.waitForTimeout(400);
  let v = await page.evaluate(id => window.__editcat.voiceFx(id), music.mediaId);
  assert.equal(v.fx, 'eco|true');
  assert.ok(v.nodes.includes('DelayNode') && v.nodes.includes('DynamicsCompressorNode'), v.nodes.join(','));
  assert.ok(v.vol > .9, 'sem abaixar: ' + v.vol);
  await page.click('#playBtn');
  // ducking on: the video's tone plays at 9.2–10.2, so the music drops
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.check('#f_duck');
  await page.evaluate(() => window.__editcat.seek(9.3));
  await page.click('#playBtn');
  await page.waitForTimeout(400);
  v = await page.evaluate(id => window.__editcat.voiceFx(id), music.mediaId);
  assert.ok(Math.abs(v.vol - 0.4) < 0.02, 'música abaixada para 40%: ' + v.vol);
  await page.click('#playBtn');
  assert.deepEqual(errors, []);
  await context.close();
});

test('congelar quadro insere uma foto de 2 s no cursor', async () => {
  const { page, context, errors } = await open();
  const T0 = await page.evaluate(() => window.__editcat.project.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0));
  await page.evaluate(() => window.__editcat.seek(1.5));
  await page.locator('.vclip').first().click();
  await page.click('[data-act="freeze"]');
  await page.waitForFunction(() => window.__editcat.project.clips.length === 5, null, { timeout: 10000 });
  const p = await P(page);
  const f = p.clips[1], m = p.media.find(x => x.id === f.mediaId);
  assert.equal(m.kind, 'image'); assert.equal(f.out - f.in, 2);
  assert.ok(Math.abs(p.clips[0].out - 1.5) < 1e-6);
  const T1 = p.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
  assert.ok(Math.abs(T1 - T0 - 2) < 1e-6);
  assert.deepEqual(errors, []);
  await context.close();
});

test('inverter gera um clipe tocando de trás para frente com a mesma duração', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'fala.webm');
  let p = await P(page);
  const vid = p.clips[p.clips.length - 1];
  await page.locator(`.vclip[data-id="${vid.id}"]`).click();
  await page.click('[data-act="reverse"]');
  await page.waitForFunction(id => { const c = window.__editcat.project.clips.find(x => x.id === id); return c && c.reversed; }, vid.id, { timeout: 30000 });
  p = await P(page);
  const c = p.clips.find(x => x.id === vid.id), nm = p.media.find(x => x.id === c.mediaId);
  assert.notEqual(nm.id, m.id); assert.equal(nm.kind, 'video'); assert.equal(c.volume, 0);
  assert.ok(Math.abs((c.out - c.in) / c.speed - 4) < 0.05, 'duração preservada: ' + (c.out - c.in) / c.speed);
  // first frame of the reversed clip shows the end of the original: testsrc frame counter differs from the start
  await page.evaluate(t => window.__editcat.seek(t), 9.25);
  await page.waitForTimeout(500);
  const px = await pixel(page, 360, 640);
  assert.ok(px[0] + px[1] + px[2] > 30, 'clipe invertido desenha');
  assert.deepEqual(errors, []);
  await context.close();
});

test('desfoque e mosaico escondem uma área e podem ser arrastados', async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => window.__editcat.seek(1));
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="mosaicbox"]');
  let p = await P(page);
  assert.equal(p.overlays[0].type, 'censor'); assert.equal(p.overlays[0].mode, 'mosaic');
  // mosaic makes neighbouring pixels equal inside a cell
  await page.waitForTimeout(100);
  const a = await pixel(page, 372, 420), b = await pixel(page, 374, 421); // same 27×26 px cell
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= 3), `mesma célula do mosaico: ${a} / ${b}`);
  const box = await page.locator('#cv').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * .4;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + box.height * .2, { steps: 4 }); await page.mouse.up();
  p = await P(page);
  assert.ok(p.overlays[0].y > .55, 'área arrastada: ' + p.overlays[0].y);
  await page.click('[data-chips="cmode"] [data-v="blur"]');
  assert.equal((await P(page)).overlays[0].mode, 'blur');
  assert.deepEqual(errors, []);
  await context.close();
});

test('gravar narração pelo microfone cria um áudio de voz', async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => window.__editcat.seek(2));
  await page.click('#recBtn');
  await page.waitForFunction(() => window.__editcat.recording, null, { timeout: 5000 });
  assert.match(await page.textContent('#recBtn'), /Parar gravação/);
  await page.waitForTimeout(1500);
  await page.click('#recBtn');
  await page.waitForFunction(() => window.__editcat.project.audios.length === 2, null, { timeout: 10000 });
  const p = await P(page);
  const a = p.audios[1], m = p.media.find(x => x.id === a.mediaId);
  assert.equal(a.role, 'voz'); assert.equal(m.name, 'Narração 1'); assert.ok(Math.abs(a.start - 2) < 1e-6);
  assert.ok(m.duration > 0.8 && m.duration < 3, 'duração ' + m.duration);
  assert.deepEqual(errors, []);
  await context.close();
});

test('exportar com camada, legenda e mosaico gera vídeo com imagem e som', async () => {
  const { page, context, errors } = await open();
  const m = await importFile(page, 'verde.png');
  await page.evaluate(id => {
    const E = window.__editcat, P = E.project;
    P.clips = P.clips.slice(0, 1); P.clips[0].out = 1.5; P.texts = []; P.audios[0].out = 1.5;
    P.overlays.push({ id: 'ov', type: 'media', mediaId: id, start: 0, in: 0, out: 1.5, volume: 1, x: .5, y: .5, scale: .4, rot: 15, opacity: .8, flip: false, blend: 'screen', mask: { type: 'circle', size: .8, feather: .2, inv: false }, chroma: { on: true, color: '#00ff00', tol: .25, soft: .1 }, filter: 'none', b: 1, c: 1, s: 1, fx: 'none', clean: false });
    P.overlays.push({ id: 'cz', type: 'censor', mode: 'blur', start: 0, dur: 1.5, x: .5, y: .2, w: .4, h: .1, strength: .6 });
    P.captions.push({ id: 'k', start: 0, dur: 1.5, text: 'Legenda exportada' });
    E.select('clip', P.clips[0].id);
  }, m.id);
  await page.click('#exportBtn');
  await page.click('#expGo');
  await page.waitForSelector('#expDone:not([hidden])', { timeout: 20000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expSave')]);
  const file = path.join(FIX, dl.suggestedFilename()); await dl.saveAs(file);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
  assert.match(probe, /video/); assert.match(probe, /audio/);
  assert.deepEqual(errors, []);
  await context.close();
});

const HOT = [[6, 10], [14, 18]];
const hotShare = clips => { let hot = 0, all = 0; clips.forEach(c => { all += c.out - c.in; HOT.forEach(([a, b]) => { hot += Math.max(0, Math.min(b, c.out) - Math.max(a, c.in)); }); }); return hot / all; };

test('corte automático escolhe os trechos com ação, na ordem, até a duração pedida', async () => {
  const { page, context, errors } = await open('');
  await importFile(page, 'acao.webm');
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-chips="autot"] [data-v="15"]');
  await page.click('[data-act="autocut"]');
  await page.waitForFunction(() => /Pronto/.test(document.getElementById('st_auto').textContent), null, { timeout: 60000 });
  const p = await P(page);
  const ranges = p.clips.map(c => [c.in, c.out]);
  for (const r of [[6, 8], [8, 10], [14, 16], [16, 18]]) assert.ok(ranges.some(([a, b]) => Math.abs(a - r[0]) < .01 && Math.abs(b - r[1]) < .01), 'tem o trecho ' + r + ' em ' + JSON.stringify(ranges));
  const T = p.clips.reduce((s, c) => s + c.out - c.in, 0);
  assert.ok(T >= 12 && T <= 15, 'duração ' + T);
  assert.ok(ranges.every((r, i) => !i || r[0] >= ranges[i - 1][1] - 1e-6), 'na ordem do vídeo');
  assert.match(await page.textContent('#st_auto'), /00:20 → 00:1[2-5]/);
  await page.click('#undoBtn');
  assert.equal((await P(page)).clips.length, 1, 'desfazer volta ao vídeo inteiro');
  assert.deepEqual(errors, []);
  await context.close();
});

test('corte automático com música corta nas batidas e prioriza a ação', async () => {
  const { page, context, errors } = await open();
  await importFile(page, 'acao.webm');
  await page.evaluate(() => { const P = window.__editcat.project; P.clips = P.clips.slice(-1); P.texts = []; P.audios[0].out = 10; });
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-chips="autot"] [data-v="0"]');
  await page.click('[data-act="autocut"]');
  await page.waitForFunction(() => /Pronto/.test(document.getElementById('st_auto').textContent), null, { timeout: 60000 });
  const p = await P(page);
  assert.match(await page.textContent('#st_auto'), /no ritmo da música/);
  let t = 0;
  for (const c of p.clips) { t += c.out - c.in; assert.ok(p.beats.some(b => Math.abs(b - t) < 1e-3), 'corte numa batida: ' + t); }
  assert.ok(t > 6 && t <= 10.5, 'cabe na música: ' + t);
  assert.ok(hotShare(p.clips) >= .75, 'maioria do tempo com ação: ' + hotShare(p.clips));
  assert.deepEqual(errors, []);
  await context.close();
});

test('remover silêncios não deixa o vídeo com um segundo: recusa e explica', async () => {
  const { page, context, errors } = await open('');
  await importFile(page, 'pouco.webm');
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="silall"]');
  assert.match(await page.textContent('#st_sil'), /Quase tudo seria cortado/);
  const p = await P(page);
  assert.equal(p.clips.length, 1); assert.ok(Math.abs(p.clips[0].out - 10) < .1, 'vídeo intacto');
  assert.equal(await page.isDisabled('#undoBtn'), false, 'a importação continua desfazível');
  await page.click('#undoBtn');
  assert.equal((await P(page)).clips.length, 0, 'nenhum passo extra no histórico');
  assert.deepEqual(errors, []);
  await context.close();
});

test('alinhar ao ritmo mantém um vídeo longo com quase o mesmo tamanho', async () => {
  const { page, context, errors } = await open();
  await importFile(page, 'acao.webm');
  await page.evaluate(() => { const P = window.__editcat.project; P.clips = P.clips.slice(-1); P.audios[0].out = 10; });
  await page.evaluate(() => window.__editcat.deselect()); await page.click('#toolsBtn');
  await page.click('[data-act="fitbeats"]');
  const c = (await P(page)).clips[0];
  assert.ok(c.out - c.in > 9, 'não encolheu para uma batida: ' + (c.out - c.in));
  assert.deepEqual(errors, []);
  await context.close();
});
