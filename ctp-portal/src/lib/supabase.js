import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  const msg = `Missing env vars — URL: ${url ? 'OK' : 'MISSING'}, KEY: ${key ? 'OK' : 'MISSING'}`;
  console.error(msg);
  document.body.innerHTML = `<div style="font-family:sans-serif;padding:40px;color:#c00"><h2>Configuration Error</h2><p>${msg}</p><p>Redeploy after setting VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify.</p></div>`;
  throw new Error(msg);
}

export const supabase = createClient(url, key);
