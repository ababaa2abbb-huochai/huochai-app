import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 正式版：打包成單一 index.html（和「衣目了然」一樣上傳到 robertya.com 即可）
// 試玩版：含瀏覽器內資料庫，輸出到 dist-demo/（多個檔案）
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: './',
    plugins: [preact(), ...(demo ? [] : [viteSingleFile()])],
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    worker: { format: 'es' },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      target: 'es2020',
      assetsInlineLimit: demo ? 0 : 100000000,
    },
  };
});
