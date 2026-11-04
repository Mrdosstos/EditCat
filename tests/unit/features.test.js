const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

let n = 0;
const uid = () => 'n' + (++n);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const clip = (id, len, extra) => Object.assign({ id, mediaId: 'm', in: 0, out: len, speed: 1, volume: 1, filter: 'none', b: 1, c: 1, s: 1, trans: 'none', x: .5, y: .5, scale: 1, rot: 0, opacity: 1 }, extra);

/* ---------- keyframes ---------- */
test('kfValue: sem chaves usa o valor fixo; com chaves interpola suave e segura nas pontas', () => {
  const o = { scale: 1 };
  assert.equal(C.kfValue(o, 'scale', 3, 1), 1);
  assert.equal(C.kfValue({}, 'x', 0, .5), .5);
  C.setKey(o, 'scale', 0, 1); C.setKey(o, 'scale', 2, 2);
  near(C.kfValue(o, 'scale', -1), 1);
  near(C.kfValue(o, 'scale', 1), 1.5);
  assert.ok(C.kfValue(o, 'scale', .5) < 1.25, 'começa devagar (ease)');
  near(C.kfValue(o, 'scale', 5), 2);
});

test('setKey atualiza a chave existente e mantém ordem', () => {
  const o = {};
  C.setKey(o, 'x', 2, .9); C.setKey(o, 'x', 0, .1); C.setKey(o, 'x', 2.005, .8);
  assert.deepEqual(o.kf.x.map(k => k.t), [0, 2]);
  assert.equal(o.kf.x[1].v, .8);
});

test('toggleKey adiciona chaves em todas as propriedades e remove no mesmo ponto', () => {
  const o = { x: .3, y: .5, scale: 2, rot: 10, opacity: 1 };
  assert.equal(C.hasKeys(o), false);
  assert.equal(C.toggleKey(o, 1, {}), true);
  assert.deepEqual(C.KF_PROPS.map(p => o.kf[p][0].v), [.3, .5, 2, 10, 1]);
  assert.ok(C.hasKeyAt(o, 1)); assert.ok(!C.hasKeyAt(o, 1.5));
  assert.deepEqual(C.keyTimes(o), [1]);
  assert.equal(C.toggleKey(o, 1, {}), false);
  assert.equal(C.hasKeys(o), false);
});

test('setProp cria chave automática só quando a propriedade já é animada', () => {
  const o = { x: .5 };
  C.setProp(o, 'x', 1, .2); assert.equal(o.x, .2); assert.equal(o.kf, undefined);
  C.setKey(o, 'x', 0, .2);
  C.setProp(o, 'x', 2, .8);
  assert.equal(o.x, .2);
  assert.deepEqual(o.kf.x.map(k => [k.t, k.v]), [[0, .2], [2, .8]]);
});

test('dividir um clipe animado desloca as chaves da peça da direita', () => {
  const P = C.newProject();
  const c = clip('c', 4); C.setKey(c, 'scale', 0, 1); C.setKey(c, 'scale', 4, 3);
  P.clips = [c];
  const s = C.split(P, { type: 'clip', id: 'c' }, 1, uid);
  const r = P.clips.find(x => x.id === s.id);
  assert.deepEqual(r.kf.scale.map(k => k.t), [-1, 3]);
  near(C.kfValue(r, 'scale', 0), C.kfValue(c, 'scale', 1));
});

/* ---------- layers / captions in the project ---------- */
test('total, split, duplicar e excluir valem para camadas e legendas', () => {
  const P = C.newProject();
  P.overlays = [{ id: 'o1', type: 'media', mediaId: 'm', start: 2, in: 1, out: 5 }, { id: 'o2', type: 'censor', start: 0, dur: 9 }];
  P.captions = [{ id: 'k1', start: 1, dur: 2, text: 'olá mundo bonito', words: [{ w: 'olá', t: 0, e: .5 }, { w: 'mundo', t: .6, e: 1.1 }, { w: 'bonito', t: 1.2, e: 1.9 }] }];
  assert.equal(C.total(P), 9);
  const so = C.split(P, { type: 'overlay', id: 'o1' }, 3, uid);
  const ro = P.overlays.find(o => o.id === so.id);
  assert.equal(P.overlays[0].out, 2); assert.equal(ro.in, 2); assert.equal(ro.start, 3);
  const sc = C.split(P, { type: 'overlay', id: 'o2' }, 4, uid);
  assert.equal(P.overlays.find(o => o.id === sc.id).dur, 5);
  const sk = C.split(P, { type: 'cap', id: 'k1' }, 2.1, uid);
  const rk = P.captions.find(c => c.id === sk.id);
  assert.equal(P.captions[0].text, 'olá mundo'); assert.equal(rk.text, 'bonito');
  near(rk.words[0].t, 0.1); // 1.2 - 1.1
  const d = C.duplicate(P, { type: 'cap', id: 'k1' }, uid);
  near(P.captions.find(c => c.id === d.id).start, 2.1);
  assert.ok(C.remove(P, { type: 'overlay', id: 'o2' }));
  assert.ok(!P.overlays.some(o => o.id === 'o2'));
});

test('upgrade preenche campos de projetos antigos', () => {
  const old = { v: 1, name: 'x', aspect: '9:16', bg: '#000', media: [], clips: [{ id: 'a', in: 0, out: 1, speed: 1 }], texts: [], audios: [{ id: 'b', in: 0, out: 1 }] };
  const P = C.upgrade(old);
  assert.deepEqual(P.overlays, []); assert.deepEqual(P.captions, []); assert.deepEqual(P.beats, []);
  assert.equal(P.capStyle.karaoke, true); assert.equal(P.duck.on, false);
  assert.equal(P.clips[0].scale, 1); assert.equal(P.audios[0].role, 'musica');
});

test('pruneMissing mantém áreas de censura (não dependem de mídia)', () => {
  const P = C.newProject();
  P.overlays = [{ id: 'a', type: 'media', mediaId: 'x' }, { id: 'b', type: 'censor' }];
  C.pruneMissing(P, []);
  assert.deepEqual(P.overlays.map(o => o.id), ['b']);
});

/* ---------- audio analysis ---------- */
function toneWithGaps(sr, parts) { // parts: [[seconds, on]]
  const out = [];
  parts.forEach(([s, on]) => { for (let i = 0; i < s * sr; i++) out.push(on ? Math.sin(i / sr * 2 * Math.PI * 220) * .5 : (Math.random() - .5) * .002); });
  return Float32Array.from(out);
}
test('envelope e speechRegions acham os trechos com som', () => {
  const sr = 8000, sig = toneWithGaps(sr, [[1, true], [1, false], [1.5, true], [.8, false]]);
  const env = C.envelope(sig, sr);
  assert.equal(env.length, Math.floor(sig.length / (sr / 50)));
  near(C.envAt(env, .5), .3536, .01); // RMS of a 0.5 sine
  const r = C.speechRegions(env, { pad: 0 });
  assert.equal(r.length, 2);
  near(r[0][0], 0, .03); near(r[0][1], 1, .03); near(r[1][0], 2, .03); near(r[1][1], 3.5, .03);
});
test('speechRegions junta pausas curtas e aplica margem', () => {
  const sr = 8000, sig = toneWithGaps(sr, [[1, true], [.2, false], [1, true]]);
  const r = C.speechRegions(C.envelope(sig, sr), { minSilence: .35, pad: .1 });
  assert.equal(r.length, 1); near(r[0][0], 0, .03); near(r[0][1], 2.2, .03);
});
test('removeSilences troca o clipe pelos pedaços com som e devolve o tempo cortado', () => {
  const P = C.newProject();
  P.clips = [clip('a', 2), clip('v', 6, { trans: 'fade' }), clip('b', 1)];
  const cut = C.removeSilences(P, 'v', [[0, 1], [2.5, 4], [5.5, 9]], uid);
  near(cut, 6 - (1 + 1.5 + .5));
  assert.deepEqual(P.clips.map(c => [c.in, c.out]), [[0, 2], [0, 1], [2.5, 4], [5.5, 6], [0, 1]]);
  assert.equal(P.clips[1].id, 'v'); assert.equal(P.clips[1].trans, 'fade'); assert.equal(P.clips[2].trans, 'none');
  assert.equal(C.removeSilences(P, 'a', [[0, 2]], uid), 0, 'sem silêncio não mexe');
  assert.equal(C.removeSilences(P, 'nada', [[0, 1]], uid), 0);
});
test('detectBeats encontra batidas regulares', () => {
  const rate = 50, env = new Float32Array(rate * 6);
  for (let i = 0; i < env.length; i++) env[i] = .01;
  const beats = [0.5, 1.125, 1.75, 2.375, 3, 3.625, 4.25, 4.875, 5.5];
  beats.forEach(b => { const i = Math.round(b * rate); env[i] = .6; env[i + 1] = .4; env[i + 2] = .2; });
  const got = C.detectBeats(env);
  assert.equal(got.length, beats.length);
  got.forEach((g, i) => near(g, beats[i], .03));
});
test('fitClipsToBeats faz cada clipe terminar numa batida, respeitando a mídia', () => {
  const P = C.newProject();
  P.clips = [clip('a', 3), clip('b', 3), clip('c', 0.5, {})];
  const n = C.fitClipsToBeats(P, [0.2, 1, 2.1, 4], c => (c.id === 'c' ? 0.5 : 10));
  assert.equal(n, 2);
  near(P.clips[0].out, 1); near(P.clips[1].out, 1.1);
});
test('normalizeGain sobe áudio baixo e desce áudio alto, com limites', () => {
  near(C.normalizeGain(Float32Array.from([.06, .06, 0]), .01), 2);
  near(C.normalizeGain(Float32Array.from([.24, .24]), .01), .5);
  assert.equal(C.normalizeGain(Float32Array.from([0, 0]), .01), 1);
  assert.equal(C.normalizeGain(Float32Array.from([5]), .01), .1);
});

/* ---------- captions ---------- */
test('splitScript quebra por frase e por tamanho', () => {
  const r = C.splitScript('Olá pessoal! Hoje vou mostrar como editar um vídeo inteiro só pelo navegador.\nVamos lá', 24);
  assert.equal(r[0], 'Olá pessoal!');
  assert.ok(r.every(x => x.length <= 24 || !x.includes(' ')));
  assert.equal(r[r.length - 1], 'Vamos lá');
});
test('scriptToCaptions encaixa o roteiro nos trechos com fala, sem atravessar pausas', () => {
  const caps = C.scriptToCaptions('Primeira frase aqui. Segunda frase.', [[1, 3], [5, 6]], 32);
  assert.equal(caps.length, 2);
  near(caps[0].start, 1, .01);
  assert.ok(caps[0].start + caps[0].dur <= 3 + 1e-6);
  assert.ok(caps[1].start >= 1 && caps[1].start + caps[1].dur <= 6 + 1e-6);
  assert.deepEqual(C.scriptToCaptions('', [[0, 1]]), []);
  assert.deepEqual(C.scriptToCaptions('oi', []), []);
});
test('groupWords junta palavras em legendas e quebra em pausa, ponto ou tamanho', () => {
  const w = [['Oi', 0, .3], ['gente,', .35, .7], ['tudo', .75, 1], ['bem?', 1.05, 1.4], ['Hoje', 2.6, 2.9], ['vamos', 2.95, 3.3], ['editar', 3.35, 3.8]].map(([w, t, e]) => ({ w, t, e }));
  const caps = C.groupWords(w, 30, .7);
  assert.equal(caps.length, 2);
  assert.equal(caps[0].text, 'Oi gente, tudo bem?');
  near(caps[0].start, 0); near(caps[0].dur, 1.4);
  assert.equal(caps[1].text, 'Hoje vamos editar');
  near(caps[1].words[1].t, .35);
  assert.equal(C.groupWords([{ w: ' ', t: 0 }]).length, 0);
  assert.equal(C.groupWords(w, 10).length > 2, true);
});
test('captionWordAt usa o tempo das palavras ou divide pelo tamanho', () => {
  const cap = { text: 'um dois três', dur: 3, words: [{ w: 'um', t: 0, e: .5 }, { w: 'dois', t: 1, e: 1.5 }, { w: 'três', t: 2, e: 2.5 }] };
  assert.equal(C.captionWordAt(cap, .2), 0); assert.equal(C.captionWordAt(cap, 1.2), 1); assert.equal(C.captionWordAt(cap, 2.9), 2);
  const even = { text: 'aa bb', dur: 2 };
  assert.equal(C.captionWordAt(even, .5), 0); assert.equal(C.captionWordAt(even, 1.5), 1);
  assert.equal(C.captionWordAt({ text: '', dur: 1 }, 0), -1);
});

/* ---------- picture & structure ---------- */
test('chromaKey remove o verde e mantém as outras cores', () => {
  const px = Uint8ClampedArray.from([0, 255, 0, 255, 20, 230, 30, 255, 255, 0, 0, 255, 240, 240, 240, 255]);
  C.chromaKey(px, '#00ff00', .25, .1);
  assert.equal(px[3], 0); assert.equal(px[7], 0);
  assert.equal(px[11], 255); assert.equal(px[15], 255);
  assert.deepEqual(C.hexRgb('#ff8000'), [255, 128, 0]);
});
test('detachAudio cria o áudio no mesmo ponto e silencia o clipe', () => {
  const P = C.newProject();
  P.clips = [clip('a', 2), clip('v', 5, { in: 1, out: 4, volume: .7 })];
  const a = C.detachAudio(P, 'v', uid);
  assert.equal(a.start, 2); assert.equal(a.in, 1); assert.equal(a.out, 4); assert.equal(a.volume, .7); assert.equal(a.role, 'voz');
  assert.equal(P.clips[1].volume, 0); assert.ok(P.clips[1].detached);
  assert.equal(C.detachAudio(P, 'v', uid), null, 'não separa duas vezes');
  P.clips[0].speed = 2;
  assert.equal(C.detachAudio(P, 'a', uid), null, 'não separa com velocidade alterada');
});
test('insertClipAt corta o clipe de baixo ou encaixa na borda', () => {
  const P = C.newProject();
  P.clips = [clip('a', 2), clip('b', 2)];
  C.insertClipAt(P, 1, clip('f', 1), uid);
  assert.deepEqual(P.clips.map(c => c.id.startsWith('n') ? 'a2' : c.id), ['a', 'f', 'a2', 'b']);
  C.insertClipAt(P, C.mainTotal(P), clip('z', 1), uid);
  assert.equal(P.clips[P.clips.length - 1].id, 'z');
  C.insertClipAt(P, 0, clip('s', 1), uid);
  assert.equal(P.clips[0].id, 's');
});
test('snapTime também gruda nas batidas marcadas', () => {
  const P = C.newProject(); P.beats = [3.3];
  near(C.snapTime(P, 3.25, 0, .1), 3.3);
});
