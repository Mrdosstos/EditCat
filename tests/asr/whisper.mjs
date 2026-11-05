// Real speech-model test (runs in GitHub Actions, which can download the model):
// a synthetic voice says Portuguese phrases at known times; the same settings as the app must give
// word times that, after EditCat's alignment, sit inside the spoken parts and never past the end.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from '@huggingface/transformers';
const C = createRequire(import.meta.url)('../../src/core.js');

const dir = mkdtempSync(join(tmpdir(), 'asr-'));
const phrases = [[0.5, 'olá pessoal tudo bem'], [4.5, 'hoje vamos editar um vídeo'], [9.5, 'o carro ficou muito bonito']];
const SR = 16000, DUR = 13;
const parts = phrases.map(([at, text], i) => {
  const f = join(dir, `p${i}.wav`);
  execFileSync('espeak-ng', ['-v', 'pt-br', '-s', '150', '-w', f, text]);
  return { at, f };
});
const inputs = parts.flatMap(p => ['-i', p.f]);
const filt = parts.map((p, i) => `[${i}:a]aresample=${SR},adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[a${i}]`).join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0,apad,atrim=0:${DUR}[out]`;
const raw = join(dir, 'mix.f32');
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filt, '-map', '[out]', '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw]);
const buf = readFileSync(raw), samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

const env = C.envelope(samples, SR), regions = C.speechRegions(env, { thresh: C.autoThreshold(env), minSilence: .25, pad: .06 });
console.log('trechos com fala:', regions.map(r => r.map(x => x.toFixed(2)).join('–')).join(', '));
if (regions.length < 3) throw new Error('a voz de teste devia ter 3 trechos de fala');

let pipe, used;
for (const id of C.ASR_MODELS) { try { pipe = await pipeline('automatic-speech-recognition', id); used = id; break; } catch (e) { console.log('modelo indisponível:', id, e.message); } }
if (!pipe) throw new Error('nenhum modelo de fala carregou');
let words, mode = 'palavra';
try { words = C.asrWords(await pipe(samples, C.asrOptions(true))); } catch (e) { mode = 'frase'; console.log('sem tempo por palavra:', e.message); words = C.asrWords(await pipe(samples, C.asrOptions(false))); }
console.log(`modelo: ${used} (tempo por ${mode})`);
const inside = w => regions.some(([a, b]) => w.t >= a - 0.25 && w.e <= b + 0.25);
const rawOut = words.filter(w => !inside(w));
console.log('palavras reconhecidas:', words.map(w => `${w.w}@${w.t.toFixed(2)}-${w.e.toFixed(2)}`).join(' '));
console.log(`fora da fala antes do alinhamento: ${rawOut.length} de ${words.length}`);
const aligned = C.alignWords(words, regions, samples.length / SR);
const caps = C.groupWords(aligned);
console.log('legendas:', caps.map(c => `[${c.start.toFixed(2)}–${(c.start + c.dur).toFixed(2)}] ${c.text}`).join(' | '));

const fail = [];
if (words.length < 6) fail.push('reconheceu poucas palavras: ' + words.length);
aligned.forEach(w => { if (!regions.some(([a, b]) => w.t >= a - 1e-6 && w.e <= b + 1e-6)) fail.push(`palavra fora da fala: ${w.w} ${w.t}-${w.e}`); });
caps.forEach(c => { if (c.start + c.dur > DUR + 1e-6) fail.push('legenda depois do fim: ' + c.text); });
// every phrase gets a caption that starts near when it is spoken
phrases.forEach(([at]) => { if (!caps.some(c => Math.abs(c.start - regions.find(r => r[1] > at)[0]) < 0.6)) fail.push('frase sem legenda no começo certo: ' + at); });
const text = caps.map(c => c.text).join(' ').toLowerCase();
['pessoal', 'vídeo', 'carro'].forEach(k => { if (!text.includes(k)) console.log('aviso: não reconheceu a palavra', k); });
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('ok: legendas dentro da fala e sem passar do fim');
