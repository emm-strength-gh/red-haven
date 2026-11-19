import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const [html, css, bundle] = await Promise.all([
  readFile(new URL('../spell.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/spell.css', import.meta.url), 'utf8'),
  build({
    entryPoints: [fileURLToPath(new URL('../src/spell.js', import.meta.url))],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2022',
    write: false,
  }),
]);

const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const standalone = html
  .replace(/\s*<script id="local-spell-redirect">[^<]*<\/script>/, '')
  .replace('<link rel="icon" href="/favicon.svg"', '<link rel="icon" href="./public/favicon.svg"')
  .replace('<link rel="stylesheet" href="/src/spell.css" />', () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace('<script type="module" src="/src/spell.js"></script>', () => `<script>${js}</script>`)
  .replace('<a class="home" href="index.html">← Home</a>', '<a class="home" href="./spell-local.html">↻ Restart</a>')
  .replace(/[ \t]+$/gm, '');

if (standalone === html || standalone.includes('/src/spell.js') || standalone.includes('/src/spell.css')) {
  throw new Error('Spell It source tags were not replaced');
}
await writeFile(new URL('../spell-local.html', import.meta.url), standalone);
console.log('Built spell-local.html for opening Spell It directly from a folder.');
