// /api/invite — internal-only. Creates a client login and sends a branded
// welcome email (bilingual) with a secure link to set their password.

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
const SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!uRes.ok) return null;
  const user = await uRes.json();
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,email`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await pRes.json();
  return rows && rows[0] ? { id: user.id, ...rows[0] } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller || caller.role !== 'internal') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };
    }

    const { client_id, email, full_name, language } = JSON.parse(event.body || '{}');
    if (!client_id || !email) return { statusCode: 400, body: JSON.stringify({ error: 'client_id and email are required' }) };
    const lang = language === 'es' ? 'es' : 'en';

    // Create the user + invite link in one call (profile is created by DB trigger).
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invite',
        email,
        data: { client_id, full_name: full_name || '', language: lang },
        redirect_to: `${SITE}/welcome`
      })
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: linkData.msg || linkData.error_description || 'Could not create invite' }) };
    }
    const actionLink = linkData.action_link || (linkData.properties && linkData.properties.action_link);

    // Branded welcome email.
    let emailed = false;
    if (RESEND_KEY && actionLink) {
      const es = lang === 'es';
      const subject = es ? 'Bienvenida a tu portal de Clear Tech Partner' : 'Welcome to your Clear Tech Partner portal';
      const html = `<!doctype html><html><body style="margin:0;background:#f7f9fb;font-family:Helvetica,Arial,sans-serif;color:#101826">
      <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden">
        <div style="height:5px;background:linear-gradient(120deg,#0052FF 0%,#00B8E6 55%,#2ED6A6 100%)"></div>
        <div style="padding:32px 36px">
          <p style="font-size:11px;letter-spacing:3px;color:#5d6b7e;margin:0 0 18px">CLEAR TECH PARTNER</p>
          <h1 style="font-size:20px;margin:0 0 14px">${es ? `Hola ${full_name || ''}` : `Hi ${full_name || ''}`}</h1>
          <div style="font-size:15px;line-height:1.6;color:#33404f">
            ${es
              ? 'Tu portal de cliente ya está listo. Aquí encontrarás tus informes mensuales, las mejoras que vamos realizando y tus documentos — todo en un solo lugar seguro.<br/><br/>Pulsa el botón para crear tu contraseña y entrar por primera vez.'
              : 'Your client portal is ready. This is where you\\'ll find your monthly reports, the improvements we make along the way, and your documents — all in one secure place.<br/><br/>Click below to set your password and sign in for the first time.'}
          </div>
          <a href="${actionLink}" style="display:inline-block;margin-top:22px;background:#0052FF;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:600">${es ? 'Activar mi acceso' : 'Set up my access'}</a>
          <p style="font-size:12px;color:#8b97a5;margin-top:30px">Clear Tech Partner · Mahón, Menorca · cleartechpartner.com</p>
        </div>
      </div></body></html>`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({ from: FROM, to: [email], subject, html })
      });
      emailed = r.ok;
    }

    // Log it.
    await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_email: caller.email, action: 'client_invited', client_id, details: email })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, emailed, action_link: emailed ? undefined : actionLink })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
