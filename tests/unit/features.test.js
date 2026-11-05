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
test('fitClipsToBeats leva o fim de cada clipe à batida mais próxima, sem encolher vídeos longos', () => {
  const P = C.newProject();
  P.clips = [clip('a', 3), clip('b', 3), clip('c', 0.5, {})];
  const n = C.fitClipsToBeats(P, [0.2, 1, 2.1, 4], c => (c.id === 'c' ? 0.5 : 10));
  assert.equal(n, 2);
  near(P.clips[0].out, 2.1); near(P.clips[1].out, 1.9);
  // a 60 s video on a 0.625 s beat grid keeps (almost) its length: the old version cut it to one beat
  const Q = C.newProject(); Q.clips = [clip('v', 60)];
  const beats = Array.from({ length: 120 }, (_, i) => +(i * 0.625).toFixed(3));
  C.fitClipsToBeats(Q, beats, () => 60);
  assert.ok(Q.clips[0].out > 59 && Q.clips[0].out <= 60, 'duração ' + Q.clips[0].out);
});
test('beatInterval acha o intervalo típico entre batidas', () => {
  near(C.beatInterval([0, .625, 1.25, 1.875, 2.5, 2.6]), .625);
  assert.equal(C.beatInterval([1]), 0);
});
test('segmentScores e pickHighlights escolhem os trechos com mais movimento e som, na ordem original', () => {
  // 20 s sampled every 0.5 s: action at 6–10 s and 14–18 s
  const step = .5, n = 40, motion = new Float32Array(n), audio = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i * step, hot = (t >= 6 && t < 10) || (t >= 14 && t < 18); motion[i] = hot ? .8 + .1 * Math.sin(i) : .02; audio[i] = hot ? .3 : .01; }
  const segs = C.segmentScores(motion, audio, step, 20, 2).map(s => Object.assign(s, { key: 'v', order: 0 }));
  assert.equal(segs.length, 10);
  const pick = C.pickHighlights(segs, 8);
  assert.deepEqual(pick.map(s => [s.a, s.b]), [[6, 8], [8, 10], [14, 16], [16, 18]]);
  // story order across clips, and no overlap
  const two = C.pickHighlights([{ key: 'x', order: 1, a: 0, b: 2, score: .9 }, { key: 'y', order: 0, a: 4, b: 6, score: .5 }, { key: 'x', order: 1, a: 1, b: 3, score: .8 }], 10);
  assert.deepEqual(two.map(s => s.key + s.a), ['y4', 'x0']);
});
test('autoThreshold fica entre o ruído de fundo e a fala', () => {
  const env = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? .2 : .02));
  const t = C.autoThreshold(env);
  assert.ok(t > .02 && t < .2, 'limiar ' + t);
  assert.ok(C.autoThreshold(env, .04) < C.autoThreshold(env, .3));
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

test('alignWords tira palavras depois do fim e põe as que caíram no silêncio de volta na fala', () => {
  const regions = [[1, 2.5], [4, 6]];
  const w = [{ w: 'a', t: .4, e: .7 }, { w: 'b', t: 1.2, e: 1.6 }, { w: 'c', t: 2.8, e: 3.1 }, { w: 'd', t: 4.2, e: 6.8 }, { w: 'e', t: 9, e: 9.4 }, { w: 'f', t: 12, e: 12.5 }];
  const r = C.alignWords(w, regions, 10);
  assert.deepEqual(r.map(x => x.w), ['a', 'b', 'c', 'd']);
  near(r[0].t, 1); // was 0.6 s early, in silence
  assert.ok(r[2].e <= 2.5 + 1e-9 && r[2].t >= 1, 'c volta para o fim da primeira fala');
  near(r[3].e, 6); // cut at the end of speech
  r.forEach((x, i) => { assert.ok(regions.some(g => x.t >= g[0] - 1e-9 && x.e <= g[1] + 1e-9), 'dentro da fala: ' + x.w); if (i) assert.ok(x.t >= r[i - 1].t); });
  assert.equal(C.alignWords([{ w: 'z', t: 8, e: 8.3 }], regions, 10).length, 0, 'palavra longe de qualquer fala é descartada');
});
test('remapToLayout leva legendas junto com o trecho do vídeo e descarta as de partes cortadas', () => {
  const oldClips = [clip('v', 10, { mediaId: 'm' })];
  // new edit keeps source 6–8 then 2–4
  const newClips = [clip('a', 0, { mediaId: 'm', in: 6, out: 8 }), clip('b', 0, { mediaId: 'm', in: 2, out: 4 })];
  const caps = [
    { id: 1, start: 2.2, dur: 1, text: 'dois tres', words: [{ w: 'dois', t: 0, e: .4 }, { w: 'tres', t: .5, e: .9 }] },
    { id: 2, start: 6.5, dur: 1, text: 'seis' },
    { id: 3, start: 0.5, dur: 1, text: 'cortado' },
    { id: 4, start: 12, dur: 1, text: 'depois do fim' },
  ];
  assert.deepEqual(C.remapToLayout(oldClips, newClips, caps).map(c => c.id), [1, 2, 4], 'por padrão, o que está depois do vídeo fica');
  const r = C.remapToLayout(oldClips, newClips, caps, { dropPast: true });
  assert.deepEqual(r.map(c => c.id), [1, 2]);
  near(r[0].start, 2.2); // source 2.2 is at 2.0 + 0.2 in the new edit
  near(r[0].words[1].t, .5);
  near(r[1].start, .5); // source 6.5 → 0.5
  // speed is respected
  const r2 = C.remapToLayout(oldClips, [clip('a', 0, { mediaId: 'm', in: 0, out: 10, speed: 2 })], [{ id: 9, start: 4, dur: 2, text: 'x' }]);
  near(r2[0].start, 2); near(r2[0].dur, 1, .01);
});
