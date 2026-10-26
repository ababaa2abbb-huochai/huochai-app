// 依建置模式選擇資料來源：試玩（瀏覽器內資料庫）或正式（Supabase）
export async function loadBackend() {
  if (import.meta.env.MODE === 'demo' || import.meta.env.DEV) {
    const { demo } = await import('./demo.js');
    return demo;
  }
  const { live } = await import('./supabase.js');
  return live;
}
