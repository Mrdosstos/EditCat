// Inlines src/core.js into src/app.html.
// dist/index.html      -> page body (published as the claude.ai Artifact; the host adds the document skeleton)
// dist/editcat.html        -> standalone file you can open in any browser or host anywhere
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const core = readFileSync(new URL('src/core.js', root), 'utf8');
const app = readFileSync(new URL('src/app.html', root), 'utf8');
if (!app.includes('/*@CORE@*/')) throw new Error('core placeholder missing in src/app.html');
const page = app.replace('/*@CORE@*/', () => core);
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/index.html', root), page);
const standalone = '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + page + '\n</body></html>\n';
writeFileSync(new URL('dist/editcat.html', root), standalone);
console.log(`built dist/index.html (${(page.length / 1024).toFixed(1)} KB) and dist/editcat.html`);
