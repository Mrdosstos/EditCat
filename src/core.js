/* EditCat core: pure editing logic, no DOM. Shared by the app and the tests. */
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

  const CAP_STYLE = { font: 'figtree', size: 58, color: '#ffffff', hl: '#ffb547', style: 'outline', y: 0.78, upper: false, karaoke: true };
  function newProject() {
    return { v: 2, name: 'Projeto sem título', aspect: '9:16', bg: '#000000', media: [], clips: [], texts: [], audios: [], overlays: [], captions: [], beats: [], capStyle: Object.assign({}, CAP_STYLE), duck: { on: false, amount: 0.6 } };
  }
  /** fills fields added in later versions so old saved projects keep working */
  function upgrade(P) {
    const d = newProject();
    ['overlays', 'captions', 'beats'].forEach(k => { if (!Array.isArray(P[k])) P[k] = []; });
    P.capStyle = Object.assign({}, CAP_STYLE, P.capStyle || {});
    P.duck = Object.assign({}, d.duck, P.duck || {});
    P.clips.forEach(c => { ['x', 'y'].forEach(k => { if (c[k] == null) c[k] = 0.5; }); if (c.scale == null) c.scale = 1; if (c.rot == null) c.rot = 0; if (c.opacity == null) c.opacity = 1; if (!c.fx) c.fx = 'none'; });
    P.audios.forEach(a => { if (!a.role) a.role = 'musica'; if (!a.fx) a.fx = 'none'; });
    P.v = 2;
    return P;
  }

  const clipDur = c => (c.out - c.in) / (c.speed || 1);
  const audioDur = a => a.out - a.in;

  function layout(P) {
    let t = 0;
    return P.clips.map(c => { const s = t; t += clipDur(c); return { c, start: s, end: t }; });
  }
  const mainTotal = P => P.clips.reduce((a, c) => a + clipDur(c), 0);
  const ovDur = o => (o.type === 'censor' ? o.dur : o.out - o.in);
  function total(P) {
    return Math.max(mainTotal(P), ...P.texts.map(x => x.start + x.dur), ...P.audios.map(a => a.start + audioDur(a)),
      ...(P.overlays || []).map(o => o.start + ovDur(o)), ...(P.captions || []).map(c => c.start + c.dur), 0);
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

  const ARR = { clip: 'clips', text: 'texts', audio: 'audios', overlay: 'overlays', cap: 'captions' };
  const arrOf = (P, type) => P[ARR[type]] || [];
  function findItem(P, sel) {
    if (!sel) return null;
    return arrOf(P, sel.type).find(x => x.id === sel.id) || null;
  }
  /** [start, end] of any timeline item */
  function span(P, type, o) {
    if (type === 'clip') { const l = layout(P).find(x => x.c === o); return l ? [l.start, l.end] : [0, 0]; }
    if (type === 'audio') return [o.start, o.start + audioDur(o)];
    if (type === 'overlay') return [o.start, o.start + ovDur(o)];
    return [o.start, o.start + o.dur];
  }

  /** what "split" would cut at time t: the selected item if the cursor is inside it, else the main clip under the cursor */
  function splitTarget(P, sel, t) {
    const s = findItem(P, sel);
    if (s && sel.type !== 'clip') {
      const [a, b] = span(P, sel.type, s);
      if (t > a + 0.1 && t < b - 0.1) return { type: sel.type, o: s, start: a };
    }
    const L = layout(P);
    const l = s && sel.type === 'clip' ? L.find(x => x.c === s) : L.find(x => t >= x.start && t < x.end);
    if (l && t > l.start + 0.1 && t < l.end - 0.1) return { type: 'clip', o: l.c, start: l.start };
    return null;
  }
  /** splits in place; returns the selection for the new right-hand piece, or null */
  function split(P, sel, t, uid) {
    const st = splitTarget(P, sel, t);
    if (!st) return null;
    const o = st.o, local = t - st.start;
    const right = Object.assign({}, o, { id: uid() });
    if (o.kf) { right.kf = shiftKf(o.kf, -local); }
    if (st.type === 'clip') {
      const at = o.in + local * o.speed;
      Object.assign(right, { in: at, trans: 'none' });
      if (o.kf) right.kf = shiftKf(o.kf, -local * 1); // keyframes are in clip-local timeline seconds
      o.out = at; P.clips.splice(P.clips.indexOf(o) + 1, 0, right);
    } else if (st.type === 'text' || st.type === 'cap' || (st.type === 'overlay' && o.type === 'censor')) {
      Object.assign(right, { start: t, dur: o.start + o.dur - t });
      if (st.type === 'text') right.anim = 'none';
      if (st.type === 'cap' && o.words) {
        right.words = o.words.filter(w => w.t >= local).map(w => ({ w: w.w, t: w.t - local, e: w.e - local }));
        o.words = o.words.filter(w => w.t < local);
        right.text = right.words.map(w => w.w).join(' ') || o.text; o.text = o.words.map(w => w.w).join(' ') || o.text;
      }
      o.dur = local; arrOf(P, st.type).push(right);
    } else {
      const at = o.in + local;
      Object.assign(right, { start: t, in: at, fadeIn: 0 });
      o.out = at; o.fadeOut = 0; arrOf(P, st.type).push(right);
    }
    return { type: st.type, id: right.id };
  }
  function duplicate(P, sel, uid) {
    const s = findItem(P, sel);
    if (!s) return null;
    const n = JSON.parse(JSON.stringify(s)); n.id = uid();
    if (sel.type === 'clip') P.clips.splice(P.clips.indexOf(s) + 1, 0, n);
    else { n.start = span(P, sel.type, s)[1]; arrOf(P, sel.type).push(n); }
    return { type: sel.type, id: n.id };
  }
  function remove(P, sel) {
    const s = findItem(P, sel);
    if (!s) return false;
    const arr = arrOf(P, sel.type);
    arr.splice(arr.indexOf(s), 1);
    return true;
  }

  /** snap t to nearby edges / playhead within tolerance (seconds) */
  function snapTime(P, t, playhead, tol, excludeId) {
    const c = [0, playhead, ...(P.beats || [])];
    layout(P).forEach(l => c.push(l.start, l.end));
    ['text', 'audio', 'overlay', 'cap'].forEach(type => arrOf(P, type).forEach(x => { if (x.id !== excludeId) c.push(...span(P, type, x)); }));
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
    const base = String(name || '').normalize('NFC').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'editcat';
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
    P.overlays = (P.overlays || []).filter(o => o.type === 'censor' || ids.has(o.mediaId));
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

  /* ---------- keyframes ---------- */
  const KF_PROPS = ['x', 'y', 'scale', 'rot', 'opacity'];
  const KF_EPS = 1 / 60;
  const smooth = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  /** value of prop at clip-local time t; falls back to the static value when there are no keys */
  function kfValue(o, prop, t, def) {
    const list = o.kf && o.kf[prop];
    const base = o[prop] != null ? o[prop] : def;
    if (!list || !list.length) return base;
    if (t <= list[0].t) return list[0].v;
    const last = list[list.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (t < b.t) return a.v + (b.v - a.v) * smooth((t - a.t) / (b.t - a.t));
    }
    return last.v;
  }
  function setKey(o, prop, t, v) {
    o.kf = o.kf || {};
    const l = o.kf[prop] = o.kf[prop] || [];
    const i = l.findIndex(k => Math.abs(k.t - t) < KF_EPS);
    if (i >= 0) l[i].v = v; else { l.push({ t, v }); l.sort((a, b) => a.t - b.t); }
  }
  const hasKeys = o => !!o.kf && KF_PROPS.some(p => o.kf[p] && o.kf[p].length);
  const hasKeyAt = (o, t) => !!o.kf && KF_PROPS.some(p => o.kf[p] && o.kf[p].some(k => Math.abs(k.t - t) < KF_EPS));
  function keyTimes(o) {
    const ts = [];
    if (o.kf) KF_PROPS.forEach(p => (o.kf[p] || []).forEach(k => { if (!ts.some(x => Math.abs(x - k.t) < KF_EPS)) ts.push(k.t); }));
    return ts.sort((a, b) => a - b);
  }
  /** adds a key for every animatable prop at t (current values), or removes the keys at t; returns true when added */
  function toggleKey(o, t, defs) {
    if (hasKeyAt(o, t)) {
      KF_PROPS.forEach(p => { if (o.kf[p]) { o.kf[p] = o.kf[p].filter(k => Math.abs(k.t - t) >= KF_EPS); if (!o.kf[p].length) delete o.kf[p]; } });
      return false;
    }
    KF_PROPS.forEach(p => setKey(o, p, t, kfValue(o, p, t, defs ? defs[p] : 0)));
    return true;
  }
  /** editing a prop: auto-keys when that prop is already animated */
  function setProp(o, prop, t, v) {
    if (o.kf && o.kf[prop] && o.kf[prop].length) setKey(o, prop, t, v); else o[prop] = v;
  }
  function shiftKf(kf, dt) {
    const out = {};
    Object.keys(kf || {}).forEach(p => { out[p] = kf[p].map(k => ({ t: k.t + dt, v: k.v })); });
    return out;
  }

  /* ---------- audio analysis ---------- */
  const ENV_RATE = 50; // envelope frames per second
  function envelope(ch, sr, rate) {
    rate = rate || ENV_RATE;
    const hop = Math.max(1, Math.floor(sr / rate)), n = Math.floor(ch.length / hop), e = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * hop, end = j + hop; j < end; j += 2) { s += ch[j] * ch[j]; c++; } e[i] = Math.sqrt(s / Math.max(1, c)); }
    return e;
  }
  const envAt = (env, t, rate) => (env && env[Math.floor(t * (rate || ENV_RATE))]) || 0;
  /** silence threshold between the noise floor and the loud parts; sensitivity 0.04–0.4 (default 0.12) */
  function autoThreshold(env, sensitivity) {
    if (!env || !env.length) return 0.01;
    const s = Array.from(env).sort((a, b) => a - b), q = p => s[Math.floor(p * (s.length - 1))];
    const floor = q(0.1), loud = q(0.9), k = Math.min(0.9, (sensitivity == null ? 0.12 : sensitivity) * 2.2);
    return Math.max(0.003, floor + (loud - floor) * k);
  }
  /** spans (seconds) where the envelope is above threshold; short gaps merged, edges padded */
  function speechRegions(env, opts) {
    opts = opts || {};
    const rate = opts.rate || ENV_RATE, thr = opts.thresh != null ? opts.thresh : autoThreshold(env), minSil = opts.minSilence != null ? opts.minSilence : 0.35, pad = opts.pad != null ? opts.pad : 0.08;
    const dur = env.length / rate, raw = [];
    let a = -1;
    for (let i = 0; i <= env.length; i++) {
      const on = i < env.length && env[i] > thr;
      if (on && a < 0) a = i; else if (!on && a >= 0) { raw.push([a / rate, i / rate]); a = -1; }
    }
    const merged = [];
    raw.forEach(r => { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < minSil) last[1] = r[1]; else merged.push(r.slice()); });
    return merged.filter(r => r[1] - r[0] >= 0.06).map(r => [Math.max(0, r[0] - pad), Math.min(dur, r[1] + pad)])
      .reduce((acc, r) => { const l = acc[acc.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else acc.push(r); return acc; }, []);
  }
  /** replaces a main clip by the pieces that contain sound; returns seconds removed */
  function removeSilences(P, clipId, regions, uid) {
    const i = P.clips.findIndex(c => c.id === clipId);
    if (i < 0) return 0;
    const c = P.clips[i];
    const keep = regions.map(r => [Math.max(r[0], c.in), Math.min(r[1], c.out)]).filter(r => r[1] - r[0] > 0.05);
    const before = c.out - c.in, after = keep.reduce((s, r) => s + r[1] - r[0], 0);
    if (!keep.length || before - after < 0.05) return 0;
    const pieces = keep.map((r, k) => Object.assign(JSON.parse(JSON.stringify(c)), { id: k ? uid() : c.id, in: r[0], out: r[1], trans: k ? 'none' : c.trans, kf: c.kf ? shiftKf(c.kf, -(r[0] - c.in) / c.speed) : undefined }));
    P.clips.splice(i, 1, ...pieces);
    return (before - after) / c.speed;
  }
  /** onset detection on an envelope; returns beat times in seconds */
  function detectBeats(env, opts) {
    opts = opts || {};
    const rate = opts.rate || ENV_RATE, minGap = opts.minGap || 0.28, n = env.length;
    const flux = new Float32Array(n);
    for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
    let mean = 0; for (let i = 0; i < n; i++) mean += flux[i]; mean /= Math.max(1, n);
    const w = Math.round(rate * 0.5), beats = [];
    for (let i = 1; i < n - 1; i++) {
      if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
      let lm = 0, c = 0; for (let j = Math.max(0, i - w); j < Math.min(n, i + w); j++) { lm += flux[j]; c++; }
      lm /= c;
      if (flux[i] > lm * 1.6 + mean * 0.5 && flux[i] > 0.01) {
        const t = i / rate;
        if (!beats.length || t - beats[beats.length - 1] >= minGap) beats.push(t);
        else if (flux[i] > flux[Math.round(beats[beats.length - 1] * rate)]) beats[beats.length - 1] = t;
      }
    }
    return beats;
  }
  /** makes each main clip end on a beat; maxOut(c) limits video clips to their media length */
  /** moves each main clip's end to the beat nearest to where it ends now (never shrinking it below minDur);
      maxOut(c) limits video clips to their media length */
  function fitClipsToBeats(P, beats, maxOut, minDur) {
    minDur = minDur || 0.4;
    let t = 0, changed = 0;
    for (const c of P.clips) {
      const end = t + clipDur(c), fits = b => c.in + (b - t) * c.speed <= maxOut(c) + 1e-6;
      const cand = beats.filter(b => b >= t + minDur && fits(b));
      if (cand.length) {
        const b = cand.reduce((best, x) => (Math.abs(x - end) < Math.abs(best - end) ? x : best), cand[0]);
        c.out = c.in + (b - t) * c.speed; changed++;
      }
      t += clipDur(c);
    }
    return changed;
  }
  /** median beat interval, or 0 */
  function beatInterval(beats) {
    const g = beats.slice(1).map((b, i) => b - beats[i]).filter(x => x > 0.15).sort((a, b) => a - b);
    return g.length ? g[Math.floor(g.length / 2)] : 0;
  }
  /** normalises a series to 0..1 by its 95th percentile */
  function norm95(v) {
    const s = Array.from(v).sort((a, b) => a - b), p = s[Math.floor(0.95 * (s.length - 1))] || 0;
    return Array.from(v, x => (p > 0 ? Math.min(1, x / p) : 0));
  }
  /** cuts [0,dur] into segLen pieces and scores each by motion and sound (series sampled every `step` s) */
  function segmentScores(motion, audio, step, dur, segLen, weights) {
    weights = weights || { motion: 0.6, audio: 0.4 };
    const m = norm95(motion || []), a = norm95(audio || []), out = [];
    const mean = (arr, t0, t1) => { const i0 = Math.floor(t0 / step), i1 = Math.max(i0 + 1, Math.ceil(t1 / step)); let s = 0, n = 0; for (let i = i0; i < i1 && i < arr.length; i++) { s += arr[i]; n++; } return n ? s / n : 0; };
    for (let t = 0; t + segLen * 0.6 <= dur + 1e-6; t += segLen) {
      const b = Math.min(dur, t + segLen);
      out.push({ a: t, b, score: weights.motion * mean(m, t, b) + weights.audio * mean(a, t, b) });
    }
    return out;
  }
  /** takes the best segments until `target` seconds, then puts them back in story order */
  function pickHighlights(segs, target) {
    const chosen = []; let tot = 0;
    [...segs].sort((x, y) => y.score - x.score || x.order - y.order || x.a - y.a).forEach(sg => {
      if (tot >= target - 1e-6) return;
      if (chosen.some(c => c.key === sg.key && sg.a < c.b - 1e-6 && sg.b > c.a + 1e-6)) return;
      if (chosen.length && tot + (sg.b - sg.a) > target + 1e-6) return; // never go past the requested length
      chosen.push(sg); tot += sg.b - sg.a;
    });
    return chosen.sort((x, y) => x.order - y.order || x.a - y.a);
  }
  /** volume multiplier that brings the voiced part of a clip to the target loudness */
  function normalizeGain(env, thresh, target) {
    target = target || 0.12;
    let s = 0, c = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > thresh) { s += env[i] * env[i]; c++; }
    if (!c) return 1;
    return clamp(target / Math.sqrt(s / c), 0.1, 2);
  }

  /* ---------- captions ---------- */
  /** splits a script into caption-sized chunks */
  function splitScript(text, maxChars) {
    maxChars = maxChars || 32;
    const out = [];
    String(text).replace(/\r/g, '').split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean).forEach(sent => {
      let line = '';
      sent.split(/\s+/).forEach(w => { const t = line ? line + ' ' + w : w; if (t.length > maxChars && line) { out.push(line); line = w; } else line = t; });
      if (line) out.push(line);
    });
    return out;
  }
  /** spreads script chunks over speech regions in proportion to their length */
  function scriptToCaptions(text, regions, maxChars) {
    const chunks = splitScript(text, maxChars);
    regions = (regions || []).filter(r => r[1] > r[0]);
    if (!chunks.length || !regions.length) return [];
    const speech = regions.reduce((s, r) => s + r[1] - r[0], 0), chars = chunks.reduce((s, c) => s + c.length + 2, 0);
    const toReal = st => { for (const r of regions) { const d = r[1] - r[0]; if (st <= d + 1e-9) return r[0] + st; st -= d; } return regions[regions.length - 1][1]; };
    let acc = 0;
    return chunks.map(c => {
      const a = acc, b = acc + (c.length + 2) / chars * speech; acc = b;
      let s = toReal(a + 1e-6), e = toReal(b);
      const reg = regions.find(r => s >= r[0] - 1e-6 && s <= r[1] + 1e-6);
      if (reg && e > reg[1]) e = reg[1]; // never hold a caption across a pause
      return { start: s, dur: Math.max(0.3, e - s), text: c };
    });
  }
  /** groups recognised words [{w,t,e}] into captions with per-word timing */
  function groupWords(words, maxChars, maxGap) {
    maxChars = maxChars || 30; maxGap = maxGap || 0.7;
    const caps = []; let cur = null;
    words.filter(w => w && String(w.w).trim()).forEach(w => {
      const word = String(w.w).trim(), e = w.e != null && w.e > w.t ? w.e : w.t + 0.3;
      const len = cur ? cur.text.length + 1 + word.length : word.length;
      if (!cur || len > maxChars || w.t - cur.end > maxGap || /[.!?]$/.test(cur.text)) { cur = { start: w.t, end: e, text: word, words: [] }; caps.push(cur); }
      else { cur.text += ' ' + word; cur.end = e; }
      cur.words.push({ w: word, t: w.t, e });
    });
    return caps.map(c => ({ start: c.start, dur: Math.max(0.3, c.end - c.start), text: c.text, words: c.words.map(x => ({ w: x.w, t: x.t - c.start, e: x.e - c.start })) }));
  }
  /** index of the word being spoken at caption-local time t */
  function captionWordAt(cap, t) {
    const words = String(cap.text).split(/\s+/).filter(Boolean);
    if (!words.length) return -1;
    if (cap.words && cap.words.length === words.length) {
      let k = -1; cap.words.forEach((w, i) => { if (t >= w.t) k = i; }); return k;
    }
    const total = words.reduce((s, w) => s + w.length + 1, 0); let acc = 0;
    for (let i = 0; i < words.length; i++) { acc += words[i].length + 1; if (t < acc / total * cap.dur) return i; }
    return words.length - 1;
  }

  /* ---------- picture tools ---------- */
  const hexRgb = h => { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  /** chroma key in place on RGBA pixels: removes the key colour (distance in the CbCr plane) */
  function chromaKey(data, keyHex, tol, soft) {
    const [kr, kg, kb] = hexRgb(keyHex);
    const kcb = (-0.168736 * kr - 0.331264 * kg + 0.5 * kb) / 255, kcr = (0.5 * kr - 0.418688 * kg - 0.081312 * kb) / 255;
    soft = Math.max(0.001, soft);
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const cb = (-0.168736 * r - 0.331264 * g + 0.5 * b) / 255, cr = (0.5 * r - 0.418688 * g - 0.081312 * b) / 255;
      const d = Math.hypot(cb - kcb, cr - kcr) * 2;
      if (d < tol) data[i + 3] = 0;
      else if (d < tol + soft) {
        const f = (d - tol) / soft; data[i + 3] = data[i + 3] * f;
        if (kg > kr && kg > kb) data[i + 1] = Math.min(g, Math.max(r, b)); // green spill
      }
    }
    return data;
  }
  /** moves a video clip's sound to the audio track */
  function detachAudio(P, clipId, uid) {
    const l = layout(P).find(x => x.c.id === clipId);
    if (!l || l.c.detached) return null;
    const c = l.c;
    if (c.speed !== 1) return null;
    const a = { id: uid(), mediaId: c.mediaId, start: l.start, in: c.in, out: c.out, volume: c.volume, fadeIn: 0, fadeOut: 0, role: 'voz', fx: c.fx || 'none', clean: !!c.clean, fromClip: c.id };
    c.volume = 0; c.detached = true;
    P.audios.push(a);
    return a;
  }
  /** puts a clip on the main track at time t, cutting the clip underneath if needed */
  function insertClipAt(P, t, clip, uid) {
    const L = layout(P);
    let idx = L.findIndex(l => t < l.end - 1e-6);
    if (idx < 0) idx = P.clips.length;
    else if (t > L[idx].start + 0.05) { split(P, { type: 'clip', id: L[idx].c.id }, t, uid); idx++; }
    P.clips.splice(idx, 0, clip);
    return idx;
  }

  const core = {
    FPS, TD, ASPECTS, FILTERS, clamp, ease, tcode, secs, newProject, clipDur, audioDur, layout, mainTotal, total,
    currentIdx, filterStr, canvasSize, rows, reorderIndex, moveClip, trimClip, findItem, splitTarget, split, duplicate,
    remove, snapTime, audioGain, sourceTime, textAnim, transitionState, exportFilename, mediaKind, pruneMissing, History,
    CAP_STYLE, upgrade, ovDur, arrOf, span, KF_PROPS, kfValue, setKey, hasKeys, hasKeyAt, keyTimes, toggleKey, setProp, shiftKf,
    ENV_RATE, envelope, envAt, autoThreshold, speechRegions, removeSilences, detectBeats, fitClipsToBeats, normalizeGain,
    splitScript, scriptToCaptions, groupWords, captionWordAt, hexRgb, chromaKey, detachAudio, insertClipAt,
    beatInterval, norm95, segmentScores, pickHighlights,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.EditCatCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
