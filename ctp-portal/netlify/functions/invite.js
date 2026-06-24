var SUPABASE_URL = process.env.SUPABASE_URL;
var ANON_KEY = process.env.SUPABASE_ANON_KEY;
var SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
var RESEND_KEY = process.env.RESEND_API_KEY;
var FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
var SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.slice(7);
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  var uRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!uRes.ok) return null;
  var user = await uRes.json();
  var pRes = await fetch(
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,email',
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  var rows = await pRes.json();
  return rows && rows[0] ? { id: user.id, token: token, ...rows[0] } : null;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller || caller.role !== 'internal') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };
    }

    var body = JSON.parse(event.body || '{}');
    var client_id = body.client_id;
    var email = body.email;
    var full_name = body.full_name;
    var language = body.language;
    if (!client_id || !email) return { statusCode: 400, body: JSON.stringify({ error: 'client_id and email are required' }) };
    var lang = language === 'es' ? 'es' : 'en';

    if (!SERVICE_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Service role key not configured — needed for invites' }) };

    var linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invite',
        email: email,
        data: { client_id: client_id, full_name: full_name || '', language: lang },
        redirect_to: SITE + '/welcome'
      })
    });
    var linkData = await linkRes.json();
    if (!linkRes.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: linkData.msg || linkData.error_description || 'Could not create invite. Check service role key.' }) };
    }
    var actionLink = linkData.action_link || (linkData.properties && linkData.properties.action_link);

    var emailed = false;
    if (RESEND_KEY && actionLink) {
      var es = lang === 'es';
      var subject = es ? 'Bienvenida a tu portal de Clear Tech Partner' : 'Welcome to your Clear Tech Partner portal';
      var html = '<!doctype html><html><body style="margin:0;background:#f7f9fb;font-family:Helvetica,Arial,sans-serif;color:#101826">' +
      '<div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden">' +
        '<div style="height:5px;background:linear-gradient(120deg,#0052FF 0%,#00B8E6 55%,#2ED6A6 100%)"></div>' +
        '<div style="padding:32px 36px">' +
          '<p style="font-size:11px;letter-spacing:3px;color:#5d6b7e;margin:0 0 18px">CLEAR TECH PARTNER</p>' +
          '<h1 style="font-size:20px;margin:0 0 14px">' + (es ? 'Hola ' + (full_name || '') : 'Hi ' + (full_name || '')) + '</h1>' +
          '<div style="font-size:15px;line-height:1.6;color:#33404f">' +
            (es
              ? 'Tu portal de cliente ya esta listo. Aqui encontraras tus informes mensuales, las mejoras que vamos realizando y tus documentos — todo en un solo lugar seguro.<br/><br/>Pulsa el boton para crear tu contrasena y entrar por primera vez.'
              : 'Your client portal is ready. This is where you will find your monthly reports, the improvements we make along the way, and your documents — all in one secure place.<br/><br/>Click below to set your password and sign in for the first time.') +
          '</div>' +
          '<a href="' + actionLink + '" style="display:inline-block;margin-top:22px;background:#0052FF;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:600">' + (es ? 'Activar mi acceso' : 'Set up my access') + '</a>' +
          '<p style="font-size:12px;color:#8b97a5;margin-top:30px">Clear Tech Partner · Mahon, Menorca · cleartechpartner.com</p>' +
        '</div>' +
      '</div></body></html>';
      var r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
        body: JSON.stringify({ from: FROM, to: [email], subject: subject, html: html })
      });
      emailed = r.ok;
    }

    await fetch(SUPABASE_URL + '/rest/v1/activity_log', {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + caller.token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_email: caller.email, action: 'client_invited', client_id: client_id, details: email })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, emailed: emailed, action_link: emailed ? undefined : actionLink })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
