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

// Artifact 不收 .data 檔：改名成 .data.wasm（內容不變），並更新程式裡的檔名
const files = readdirSync(join(src, 'assets')).filter((f) => !f.endsWith('.css'));
const renames = Object.fromEntries(files.filter((f) => f.endsWith('.data')).map((f) => [f, f + '.wasm']));
for (const f of files) {
  const target = join(out, 'assets', renames[f] || f);
  if (f.endsWith('.js')) {
    let code = readFileSync(join(src, 'assets', f), 'utf8');
    for (const [a, b] of Object.entries(renames)) code = code.split(a).join(b);
    writeFileSync(target, code);
  } else {
    copyFileSync(join(src, 'assets', f), target);
  }
}
console.log(readdirSync(join(out, 'assets')).join('\n'));
