/* REO core: pure editing logic, no DOM. Shared by the app and the tests. */
(function (root) {
  'use strict';
  const FPS = 30;
  const TD = 0.5; // transition length in seconds
  const ASPECTS = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] };
  const FILTERS = [
    { id: 'none', name: 'Original', css: '' },
    { id: 'quente', name: 'Quente', css: 'sepia(.22) saturate(1.25) brightness(1.03)' },
    { id: 'frio', name: 'Frio', css: 'saturate(.9) hue-rotate(14deg) brightness(1.04) contrast(1.05)' },
    { id: 'vivo', name: 'Vivo', css: 'saturate(1.65) contrast(1.08)' },
    { id: 'retro', name: 'Retrô', css: 'sepia(.55) contrast(.9) brightness(1.06) saturate(.85)' },
    { id: 'mono', name: 'P&B', css: 'grayscale(1) contrast(1.12)' },
    { id: 'chumbo', name: 'Chumbo', css: 'brightness(.88) contrast(1.28) saturate(.55)' },
    { id: 'neon', name: 'Neon', css: 'saturate(1.4) hue-rotate(-28deg) contrast(1.15)' },
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

  /** mm:ss:ff at 30 fps */
  function tcode(t) {
    t = Math.max(0, t || 0);
    const totalFrames = Math.round(t * FPS * 1000) / 1000;
    const whole = Math.floor(totalFrames / FPS);
    const m = Math.floor(whole / 60), s = whole % 60, f = Math.floor(totalFrames - whole * FPS);
    return [m, s, f].map(n => String(n).padStart(2, '0')).join(':');
  }
  const secs = t => (t < 60 ? t.toFixed(1) + 's' : tcode(t).slice(0, 5));

  function newProject() {
    return { v: 1, name: 'Projeto sem título', aspect: '9:16', bg: '#000000', media: [], clips: [], texts: [], audios: [] };
  }

  const clipDur = c => (c.out - c.in) / (c.speed || 1);
  const audioDur = a => a.out - a.in;

  function layout(P) {
    let t = 0;
    return P.clips.map(c => { const s = t; t += clipDur(c); return { c, start: s, end: t }; });
  }
  const mainTotal = P => P.clips.reduce((a, c) => a + clipDur(c), 0);
  function total(P) {
    return Math.max(mainTotal(P), ...P.texts.map(x => x.start + x.dur), ...P.audios.map(a => a.start + audioDur(a)), 0);
  }
  /** index of the main-track clip shown at time t (holds the last frame exactly at the end) */
  function currentIdx(L, t) {
    let i = L.findIndex(l => t >= l.start && t < l.end);
    if (i < 0 && L.length && t >= L[L.length - 1].end - 1e-6 && t <= L[L.length - 1].end + 0.05) i = L.length - 1;
    return i;
  }

  function filterStr(c) {
    const f = (FILTERS.find(x => x.id === c.filter) || FILTERS[0]).css;
    const adj = (c.b !== 1 ? ` brightness(${c.b})` : '') + (c.c !== 1 ? ` contrast(${c.c})` : '') + (c.s !== 1 ? ` saturate(${c.s})` : '');
    return (f + adj).trim() || 'none';
  }

  function canvasSize(aspect, quality) {
    const [a, b] = ASPECTS[aspect] || ASPECTS['9:16'];
    const short = String(quality) === '1080' ? 1080 : 720;
    let w, h;
    if (a >= b) { h = short; w = Math.round(short * a / b); } else { w = short; h = Math.round(short * b / a); }
    return { w: w + (w % 2), h: h + (h % 2) };
  }

  /** greedy lane packing for overlapping items */
  function rows(items, startF, endF) {
    const ends = [], map = {};
    [...items].sort((a, b) => startF(a) - startF(b)).forEach(it => {
      let r = ends.findIndex(e => e <= startF(it) + 1e-3);
      if (r < 0) { r = ends.length; ends.push(0); }
      ends[r] = endF(it); map[it.id] = r;
    });
    return { map, n: Math.max(1, ends.length) };
  }

  /** where a dragged main clip lands when the pointer is at time t (stable: ignores the dragged clip) */
  function reorderIndex(clips, dragged, t) {
    let acc = 0, k = 0;
    clips.filter(x => x !== dragged).forEach(x => { const d = clipDur(x); if (acc + d / 2 < t) k++; acc += d; });
    return k;
  }
  function moveClip(P, dragged, t) {
    const i = P.clips.indexOf(dragged), k = reorderIndex(P.clips, dragged, t);
    if (i < 0 || k === i) return false;
    P.clips.splice(i, 1); P.clips.splice(k, 0, dragged);
    return true;
  }

  const MIN = 0.2;
  function trimClip(c, side, o, ds, maxOut) {
    if (side === 'l') c.in = clamp(o.in + ds * c.speed, 0, o.out - MIN * c.speed);
    else c.out = clamp(o.out + ds * c.speed, c.in + MIN * c.speed, maxOut);
  }

  function findItem(P, sel) {
    if (!sel) return null;
    const arr = sel.type === 'clip' ? P.clips : sel.type === 'text' ? P.texts : P.audios;
    return arr.find(x => x.id === sel.id) || null;
  }

  /** what "split" would cut at time t: the selected item if the cursor is inside it, else the main clip under the cursor */
  function splitTarget(P, sel, t) {
    const s = findItem(P, sel);
    if (s && sel.type === 'text' && t > s.start + 0.1 && t < s.start + s.dur - 0.1) return { type: 'text', o: s };
    if (s && sel.type === 'audio' && t > s.start + 0.1 && t < s.start + audioDur(s) - 0.1) return { type: 'audio', o: s };
    const L = layout(P);
    const l = s && sel.type === 'clip' ? L.find(x => x.c === s) : L.find(x => t >= x.start && t < x.end);
    if (l && t > l.start + 0.1 && t < l.end - 0.1) return { type: 'clip', o: l.c, start: l.start };
    return null;
  }
  /** splits in place; returns the selection for the new right-hand piece, or null */
  function split(P, sel, t, uid) {
    const st = splitTarget(P, sel, t);
    if (!st) return null;
    const o = st.o;
    if (st.type === 'clip') {
      const at = o.in + (t - st.start) * o.speed;
      const n = Object.assign({}, o, { id: uid(), in: at, trans: 'none' });
      o.out = at; P.clips.splice(P.clips.indexOf(o) + 1, 0, n);
      return { type: 'clip', id: n.id };
    }
    if (st.type === 'text') {
      const n = Object.assign({}, o, { id: uid(), start: t, dur: o.start + o.dur - t, anim: 'none' });
      o.dur = t - o.start; P.texts.push(n);
      return { type: 'text', id: n.id };
    }
    const at = o.in + (t - o.start);
    const n = Object.assign({}, o, { id: uid(), start: t, in: at, fadeIn: 0 });
    o.out = at; o.fadeOut = 0; P.audios.push(n);
    return { type: 'audio', id: n.id };
  }
  function duplicate(P, sel, uid) {
    const s = findItem(P, sel);
    if (!s) return null;
    const n = Object.assign({}, s, { id: uid() });
    if (sel.type === 'clip') P.clips.splice(P.clips.indexOf(s) + 1, 0, n);
    else if (sel.type === 'text') { n.start = s.start + s.dur; P.texts.push(n); }
    else { n.start = s.start + audioDur(s); P.audios.push(n); }
    return { type: sel.type, id: n.id };
  }
  function remove(P, sel) {
    const s = findItem(P, sel);
    if (!s) return false;
    const arr = sel.type === 'clip' ? P.clips : sel.type === 'text' ? P.texts : P.audios;
    arr.splice(arr.indexOf(s), 1);
    return true;
  }

  /** snap t to nearby edges / playhead within tolerance (seconds) */
  function snapTime(P, t, playhead, tol, excludeId) {
    const c = [0, playhead];
    layout(P).forEach(l => c.push(l.start, l.end));
    P.texts.forEach(x => { if (x.id !== excludeId) c.push(x.start, x.start + x.dur); });
    P.audios.forEach(x => { if (x.id !== excludeId) c.push(x.start, x.start + audioDur(x)); });
    let best = t, bd = tol;
    c.forEach(v => { const d = Math.abs(v - t); if (d < bd) { bd = d; best = v; } });
    return best;
  }

  /** audio clip gain at local time (volume with fades) */
  function audioGain(a, local) {
    const d = audioDur(a);
    if (local < 0 || local >= d) return 0;
    let v = a.volume;
    if (a.fadeIn > 0) v *= clamp(local / a.fadeIn, 0, 1);
    if (a.fadeOut > 0) v *= clamp((d - local) / a.fadeOut, 0, 1);
    return v;
  }
  /** source time inside the media for a main clip at timeline time t */
  function sourceTime(c, start, t) { return c.in + (t - start) * c.speed; }

  /** text entrance/exit animation state */
  function textAnim(tx, local) {
    const pin = ease(local / 0.4), pout = clamp((tx.dur - local) / 0.3, 0, 1);
    let alpha = pout, scale = 1, dy = 0, chars = Infinity;
    if (tx.anim === 'fade') alpha *= pin;
    else if (tx.anim === 'pop') {
      const p = clamp(local / 0.45, 0, 1);
      scale = p < 1 ? 0.5 + 0.5 * (1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2)) : 1;
      alpha *= clamp(local / 0.15, 0, 1);
    } else if (tx.anim === 'subir') { dy = 1 - pin; alpha *= pin; }
    else if (tx.anim === 'digitar') {
      const n = String(tx.text).replace(/\n/g, '').length, tdur = Math.min(tx.dur * 0.6, n * 0.05);
      chars = Math.floor(n * clamp(local / Math.max(0.01, tdur), 0, 1));
    }
    return { alpha, scale, dy, chars };
  }

  function transitionState(c, local) {
    const td = Math.min(TD, clipDur(c) / 2);
    if (c.trans === 'none' || local >= td) return null;
    return { kind: c.trans, p: ease(local / td) };
  }

  function exportFilename(name, ext) {
    const base = String(name || '').normalize('NFC').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'reo';
    return `${base}.${ext}`;
  }

  function mediaKind(mime) {
    mime = String(mime || '');
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
  }

  /** drop clips whose media is gone (used when restoring a saved project) */
  function pruneMissing(P, availableIds) {
    const ids = new Set(availableIds);
    P.media = P.media.filter(m => ids.has(m.id));
    P.clips = P.clips.filter(c => ids.has(c.mediaId));
    P.audios = P.audios.filter(a => ids.has(a.mediaId));
    return P;
  }

  /** bounded undo/redo stack over JSON snapshots */
  function History(limit) {
    const past = [], future = [];
    return {
      push(P) { past.push(JSON.stringify(P)); if (past.length > (limit || 100)) past.shift(); future.length = 0; },
      undo(P) { if (!past.length) return null; future.push(JSON.stringify(P)); return JSON.parse(past.pop()); },
      redo(P) { if (!future.length) return null; past.push(JSON.stringify(P)); return JSON.parse(future.pop()); },
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; },
    };
  }

  const core = {
    FPS, TD, ASPECTS, FILTERS, clamp, ease, tcode, secs, newProject, clipDur, audioDur, layout, mainTotal, total,
    currentIdx, filterStr, canvasSize, rows, reorderIndex, moveClip, trimClip, findItem, splitTarget, split, duplicate,
    remove, snapTime, audioGain, sourceTime, textAnim, transitionState, exportFilename, mediaKind, pruneMissing, History,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.ReoCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
