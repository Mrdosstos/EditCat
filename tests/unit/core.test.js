const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

let n = 0;
const uid = () => 'id' + (++n);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function clip(id, len, extra) {
  return Object.assign({ id, mediaId: 'm', in: 0, out: len, speed: 1, volume: 1, filter: 'none', b: 1, c: 1, s: 1, trans: 'none', fit: 'cover', kb: false }, extra);
}
function project() {
  const P = C.newProject();
  P.media = [{ id: 'm', kind: 'video', duration: 20 }, { id: 'a', kind: 'audio', duration: 30 }];
  P.clips = [clip('c1', 4), clip('c2', 2), clip('c3', 3)];
  P.texts = [{ id: 't1', text: 'Olá', start: 1, dur: 2, anim: 'fade' }];
  P.audios = [{ id: 'a1', mediaId: 'a', start: 0, in: 0, out: 10, volume: 1, fadeIn: 1, fadeOut: 2 }];
  return P;
}

test('tcode formata minutos, segundos e quadros a 30 fps', () => {
  assert.equal(C.tcode(0), '00:00:00');
  assert.equal(C.tcode(1.5), '00:01:15');
  assert.equal(C.tcode(61 + 29 / 30), '01:01:29');
  assert.equal(C.tcode(-3), '00:00:00');
  assert.equal(C.tcode(0.1 + 0.2), '00:00:09'); // floating-point: 0.30000000000000004 -> 9 frames
});

test('clipDur leva a velocidade em conta', () => {
  assert.equal(C.clipDur(clip('x', 4)), 4);
  assert.equal(C.clipDur(clip('x', 4, { speed: 2 })), 2);
  assert.equal(C.clipDur(clip('x', 4, { speed: 0.5 })), 8);
});

test('layout encadeia os clipes e total considera texto e áudio', () => {
  const P = project();
  const L = C.layout(P);
  assert.deepEqual(L.map(l => [l.start, l.end]), [[0, 4], [4, 6], [6, 9]]);
  assert.equal(C.mainTotal(P), 9);
  assert.equal(C.total(P), 10); // audio ends at 10
  P.texts.push({ id: 't2', start: 11, dur: 1.5 });
  assert.equal(C.total(P), 12.5);
  assert.equal(C.total(C.newProject()), 0);
});

test('currentIdx acha o clipe sob o cursor e segura o último quadro no fim', () => {
  const L = C.layout(project());
  assert.equal(C.currentIdx(L, 0), 0);
  assert.equal(C.currentIdx(L, 3.999), 0);
  assert.equal(C.currentIdx(L, 4), 1);
  assert.equal(C.currentIdx(L, 9), 2);
  assert.equal(C.currentIdx(L, 9.5), -1);
  assert.equal(C.currentIdx([], 1), -1);
});

test('split divide o clipe principal no ponto certo da mídia', () => {
  const P = project();
  P.clips[1].speed = 2; P.clips[1].out = 4; // c2 lasts 2s on the timeline, 4s of source
  P.clips[1].trans = 'fade';
  const sel = C.split(P, { type: 'clip', id: 'c2' }, 5, uid);
  assert.ok(sel);
  assert.equal(P.clips.length, 4);
  const [a, b] = [P.clips[1], P.clips[2]];
  near(a.out, 2); near(b.in, 2); near(b.out, 4);
  assert.equal(b.trans, 'none', 'a peça da direita não herda a transição de entrada');
  assert.equal(sel.id, b.id);
  near(C.mainTotal(P), 9); // duration unchanged
});

test('split sem seleção corta o clipe sob o cursor; perto da borda não corta', () => {
  const P = project();
  assert.ok(C.split(P, null, 2, uid));
  assert.equal(P.clips.length, 4);
  assert.equal(C.split(P, null, 0.05, uid), null);
  assert.equal(C.splitTarget(P, null, 50), null);
});

test('split de texto e de áudio', () => {
  const P = project();
  const s1 = C.split(P, { type: 'text', id: 't1' }, 2, uid);
  assert.equal(P.texts.length, 2);
  near(P.texts[0].dur, 1);
  const right = P.texts.find(t => t.id === s1.id);
  near(right.start, 2); near(right.dur, 1); assert.equal(right.anim, 'none');

  const s2 = C.split(P, { type: 'audio', id: 'a1' }, 4, uid);
  const [left, r] = [P.audios[0], P.audios.find(a => a.id === s2.id)];
  near(left.out, 4); near(r.in, 4); near(r.start, 4);
  assert.equal(left.fadeOut, 0); assert.equal(r.fadeIn, 0);
});

test('duplicate coloca a cópia logo depois e remove apaga', () => {
  const P = project();
  const s = C.duplicate(P, { type: 'clip', id: 'c1' }, uid);
  assert.equal(P.clips[1].id, s.id);
  assert.notEqual(P.clips[1].id, 'c1');
  const st = C.duplicate(P, { type: 'text', id: 't1' }, uid);
  assert.equal(P.texts.find(t => t.id === st.id).start, 3);
  const sa = C.duplicate(P, { type: 'audio', id: 'a1' }, uid);
  assert.equal(P.audios.find(a => a.id === sa.id).start, 10);
  assert.ok(C.remove(P, { type: 'clip', id: 'c1' }));
  assert.ok(!P.clips.some(c => c.id === 'c1'));
  assert.equal(C.remove(P, { type: 'clip', id: 'nada' }), false);
  assert.equal(C.duplicate(P, null, uid), null);
});

test('reordenar clipes é estável (sem vai-e-volta)', () => {
  const P = C.newProject();
  const A = clip('A', 1), B = clip('B', 5);
  P.clips = [A, B];
  // pointer at 1.5s, inside B but before B's midpoint (2.5s): A stays first
  assert.equal(C.moveClip(P, A, 1.5), false);
  assert.deepEqual(P.clips.map(c => c.id), ['A', 'B']);
  assert.equal(C.moveClip(P, A, 3), true);
  assert.deepEqual(P.clips.map(c => c.id), ['B', 'A']);
  // same pointer again does nothing (no oscillation)
  assert.equal(C.moveClip(P, A, 3), false);
  assert.equal(C.moveClip(P, A, 0.2), true);
  assert.deepEqual(P.clips.map(c => c.id), ['A', 'B']);
});

test('aparar respeita o mínimo de 0,2 s e os limites da mídia', () => {
  const c = clip('x', 4, { in: 1, out: 4 });
  const o = { in: 1, out: 4 };
  C.trimClip(c, 'l', o, -5, 20); assert.equal(c.in, 0);
  C.trimClip(c, 'l', o, 10, 20); near(c.in, 3.8);
  c.in = 1;
  C.trimClip(c, 'r', o, 100, 6); assert.equal(c.out, 6);
  C.trimClip(c, 'r', o, -100, 6); near(c.out, 1.2);
  const fast = clip('f', 4, { speed: 2 });
  C.trimClip(fast, 'r', { in: 0, out: 4 }, -1, 20); near(fast.out, 2); // 1s of timeline = 2s of source
});

test('snapTime gruda em bordas próximas e no cursor', () => {
  const P = project();
  near(C.snapTime(P, 4.05, 0, 0.1), 4);
  near(C.snapTime(P, 7.02, 7, 0.1), 7);
  near(C.snapTime(P, 5, 0, 0.1), 5);
  // its own edges are ignored
  near(C.snapTime(P, 1.03, 0, 0.1, 't1'), 1.03);
});

test('rows empilha itens sobrepostos em faixas', () => {
  const items = [{ id: 'a', s: 0, e: 3 }, { id: 'b', s: 1, e: 2 }, { id: 'c', s: 3, e: 4 }];
  const r = C.rows(items, x => x.s, x => x.e);
  assert.equal(r.n, 2);
  assert.equal(r.map.a, 0); assert.equal(r.map.b, 1); assert.equal(r.map.c, 0);
  assert.equal(C.rows([], x => 0, x => 0).n, 1);
});

test('audioGain aplica volume e fades', () => {
  const a = { in: 0, out: 10, volume: 0.8, fadeIn: 2, fadeOut: 2 };
  near(C.audioGain(a, 0), 0);
  near(C.audioGain(a, 1), 0.4);
  near(C.audioGain(a, 5), 0.8);
  near(C.audioGain(a, 9), 0.4);
  near(C.audioGain(a, 10), 0);
  near(C.audioGain(a, -1), 0);
});

test('filterStr combina filtro e ajustes', () => {
  assert.equal(C.filterStr({ filter: 'none', b: 1, c: 1, s: 1 }), 'none');
  assert.equal(C.filterStr({ filter: 'mono', b: 1, c: 1, s: 1 }), 'grayscale(1) contrast(1.12)');
  assert.equal(C.filterStr({ filter: 'none', b: 1.2, c: 1, s: 0 }), 'brightness(1.2) saturate(0)');
  assert.equal(C.filterStr({ filter: 'inexistente', b: 1, c: 1, s: 1 }), 'none');
});

test('canvasSize por formato e qualidade (sempre par)', () => {
  assert.deepEqual(C.canvasSize('9:16', '720'), { w: 720, h: 1280 });
  assert.deepEqual(C.canvasSize('16:9', '1080'), { w: 1920, h: 1080 });
  assert.deepEqual(C.canvasSize('1:1', '720'), { w: 720, h: 720 });
  assert.deepEqual(C.canvasSize('4:5', '1080'), { w: 1080, h: 1350 });
  assert.deepEqual(C.canvasSize('xx', '720'), { w: 720, h: 1280 });
});

test('textAnim: entrada, saída e digitação', () => {
  const tx = { text: 'abcdefghij', dur: 3, anim: 'fade' };
  near(C.textAnim(tx, 0).alpha, 0);
  near(C.textAnim(tx, 1).alpha, 1);
  near(C.textAnim(tx, 2.85).alpha, 0.5);
  const pop = C.textAnim({ ...tx, anim: 'pop' }, 0.2);
  assert.ok(pop.scale > 0.5 && pop.scale < 1.2);
  assert.equal(C.textAnim({ ...tx, anim: 'pop' }, 1).scale, 1);
  const typ = { ...tx, anim: 'digitar' };
  assert.equal(C.textAnim(typ, 0).chars, 0);
  assert.equal(C.textAnim(typ, 0.25).chars, 5);
  assert.equal(C.textAnim(typ, 2).chars, 10);
  assert.ok(C.textAnim({ ...tx, anim: 'subir' }, 0).dy > 0.99);
});

test('transitionState só existe no começo do clipe', () => {
  const c = clip('x', 4, { trans: 'zoom' });
  assert.equal(C.transitionState(c, 0).p, 0);
  assert.equal(C.transitionState(c, 0.6), null);
  assert.equal(C.transitionState(clip('y', 4), 0), null);
  // short clip: transition is at most half its length
  const short = clip('s', 0.4, { trans: 'fade' });
  assert.equal(C.transitionState(short, 0.25), null);
});

test('exportFilename limpa o nome do projeto', () => {
  assert.equal(C.exportFilename('Férias na praia!', 'mp4'), 'Férias-na-praia.mp4');
  assert.equal(C.exportFilename('../../etc/passwd', 'webm'), 'etcpasswd.webm');
  assert.equal(C.exportFilename('', 'mp4'), 'editcat.mp4');
  assert.equal(C.exportFilename('   ', 'mp4'), 'editcat.mp4');
  assert.ok(C.exportFilename('x'.repeat(200), 'mp4').length <= 64);
});

test('mediaKind reconhece vídeo, foto e áudio', () => {
  assert.equal(C.mediaKind('video/mp4'), 'video');
  assert.equal(C.mediaKind('image/jpeg'), 'image');
  assert.equal(C.mediaKind('audio/mpeg'), 'audio');
  assert.equal(C.mediaKind('application/pdf'), null);
  assert.equal(C.mediaKind(''), null);
});

test('pruneMissing tira clipes sem mídia', () => {
  const P = project();
  C.pruneMissing(P, ['a']);
  assert.equal(P.clips.length, 0);
  assert.equal(P.audios.length, 1);
  assert.equal(P.texts.length, 1);
});

test('History desfaz e refaz; nova ação limpa o refazer', () => {
  const h = C.History(3);
  let P = { v: 1 };
  assert.equal(h.canUndo, false);
  h.push(P); P = { v: 2 };
  h.push(P); P = { v: 3 };
  P = h.undo(P); assert.equal(P.v, 2);
  assert.equal(h.canRedo, true);
  P = h.redo(P); assert.equal(P.v, 3);
  P = h.undo(P); h.push(P); assert.equal(h.canRedo, false);
  for (let i = 0; i < 10; i++) h.push({ v: i });
  let k = 0; while (h.undo({})) k++;
  assert.equal(k, 3, 'limite de histórico respeitado');
  assert.equal(h.redo !== undefined, true);
});
