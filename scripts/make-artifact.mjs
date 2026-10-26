// 把試玩版（dist-demo/）整理成可以發布成 Artifact 的資料夾（artifact/）
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const src = 'dist-demo';
const out = 'artifact';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const html = readFileSync(join(src, 'index.html'), 'utf8');
const script = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const css = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)[1];
const cssText = readFileSync(join(src, css), 'utf8');

const page = `<title>賣女孩的小火柴</title>
<meta name="description" content="整理師夥伴的排班與找人 App（試玩版）">
<style>${cssText}</style>
<div id="app"></div>
<script type="module" src="${script}"></script>
`;
writeFileSync(join(out, 'index.html'), page);

for (const f of readdirSync(join(src, 'assets'))) {
  if (f.endsWith('.css')) continue;
  copyFileSync(join(src, 'assets', f), join(out, 'assets', f));
}
console.log(readdirSync(join(out, 'assets')).join('\n'));
