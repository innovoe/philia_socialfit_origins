import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';

const gateHtml = await readFile(new URL('./index.html', import.meta.url));
const previewHtml = await readFile(new URL('./preview.html', import.meta.url));
const rsvpHtml = await readFile(new URL('./rsvp.html', import.meta.url));
const port = Number(process.env.PORT || 3000);

const accessSecret = process.env.ORIGINS_LINK_SECRET || '';
const gateDisabled = process.env.ORIGINS_GATE_DISABLED === 'true';
const apiBase = (process.env.ORIGINS_API_BASE || '').replace(/\/+$/, '');
const signingSecret = accessSecret;
const cookieName = 'socialfit_origins_access';
const sessionDays = 7;
const previewSource = 'origins_interactive_preview';

function sign(payload, secret = signingSecret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safelyEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyAccessToken(token) {
  if (!signingSecret || typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safelyEqual(signature, sign(payload))) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.cohort !== 'origins' || typeof claims.email !== 'string') return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function issueAccessToken(email) {
  const exp = Math.floor(Date.now() / 1000) + sessionDays * 24 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ email, cohort: 'origins', exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return index === -1 ? [value, ''] : [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
  }));
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwardedProto === 'https' || process.env.NODE_ENV === 'production';
}

function accessCookie(req, token, secondsLeft = sessionDays * 24 * 60 * 60) {
  const secure = isSecureRequest(req);
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${secondsLeft}${secure ? '; Secure' : ''}`;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 4096) {
        req.destroy();
        reject(new Error('too_large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function sessionFrom(req) {
  return verifyAccessToken(cookies(req)[cookieName]);
}

async function djangoPost(req, path, body) {
  if (!apiBase) return { status: 503, data: { error: 'upstream_unavailable' } };
  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    const ip = clientIp(req);
    if (ip) headers['X-Forwarded-For'] = ip;
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { status: 503, data: { error: 'upstream_unavailable' } };
    }
    if (response.status >= 400 && typeof data.error !== 'string') {
      return { status: 503, data: { error: 'upstream_unavailable' } };
    }
    return { status: response.status, data };
  } catch {
    return { status: 503, data: { error: 'upstream_unavailable' } };
  }
}

if (!signingSecret && !gateDisabled) {
  console.warn('Origins gate is closed: set ORIGINS_LINK_SECRET before sharing the preview.');
}
if (!apiBase) {
  console.warn('ORIGINS_API_BASE is not set; access and preview actions cannot reach Django.');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/health') {
    res.writeHead(200, {...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : 'ok');
    return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  if (pathname === '/api/access/me') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const claims = sessionFrom(req);
    if (!claims && !gateDisabled) { json(res, 401, { error: 'unauthorized' }); return; }
    json(res, 200, { email: claims?.email || '' });
    return;
  }

  if (pathname === '/api/access/start') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    try {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      if (!isEmail(email)) { json(res, 400, { error: 'invalid_email' }); return; }
      const { status, data } = await djangoPost(req, '/access/start/', { email });
      json(res, status, data.error === 'upstream_unavailable' ? { error: 'email_send_failed' } : data);
    } catch {
      json(res, 400, { error: 'invalid_json' });
    }
    return;
  }

  if (pathname === '/api/access/verify') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    try {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const code = String(body.code || '').trim();
      if (!isEmail(email)) { json(res, 400, { error: 'invalid_email' }); return; }
      const { status, data } = await djangoPost(req, '/access/verify/', { email, code });
      if (status >= 200 && status < 300 && data.ok) {
        const verified = isEmail(normalizeEmail(data.email)) ? normalizeEmail(data.email) : email;
        const token = issueAccessToken(verified);
        json(res, 200, { ok: true, email: verified }, { 'Set-Cookie': accessCookie(req, token) });
        return;
      }
      json(res, status, data);
    } catch {
      json(res, 400, { error: 'invalid_json' });
    }
    return;
  }

  if (pathname === '/api/preview/excited' || pathname === '/api/preview/keys') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    const claims = sessionFrom(req);
    if (!claims && !gateDisabled) { json(res, 401, { error: 'unauthorized' }); return; }
    const email = normalizeEmail(claims?.email);
    if (!isEmail(email)) { json(res, 401, { error: 'unauthorized' }); return; }
    try {
      const body = await readJson(req);
      const source = String(body.source || previewSource).trim().slice(0, 120) || previewSource;
      const path = pathname === '/api/preview/excited' ? '/preview/excited/' : '/preview/keys/';
      const { status, data } = await djangoPost(req, path, { email, source });
      json(res, status, data);
    } catch {
      json(res, 400, { error: 'invalid_json' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); res.end(); return; }
  if (pathname === '/preview.html') { res.writeHead(404); res.end('Not found'); return; }
  if (pathname === '/rsvp' || pathname === '/rsvp/') {
    res.writeHead(200, {...securityHeaders('text/html; charset=utf-8'), 'Cache-Control':'private, no-store'});
    res.end(req.method === 'HEAD' ? undefined : rsvpHtml);
    return;
  }
  if (!['/', '/index.html'].includes(pathname)) { res.writeHead(404); res.end('Not found'); return; }

  const linkToken = url.searchParams.get('origin');
  const claims = verifyAccessToken(linkToken);
  if (claims) {
    const secondsLeft = Math.max(60, Math.min(sessionDays * 24 * 60 * 60, claims.exp - Math.floor(Date.now() / 1000)));
    res.writeHead(302, {
      ...securityHeaders('text/plain; charset=utf-8'),
      'Cache-Control': 'no-store',
      'Set-Cookie': accessCookie(req, linkToken, secondsLeft),
      Location: '/'
    });
    res.end();
    return;
  }

  const sessionClaims = sessionFrom(req);
  const maySeePreview = gateDisabled || Boolean(sessionClaims);
  const body = maySeePreview ? previewHtml : gateHtml;
  res.writeHead(200, {...securityHeaders('text/html; charset=utf-8'), 'Cache-Control':'private, no-store'});
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '0.0.0.0', () => {
  console.log(`SocialFit demo listening on port ${port}${apiBase ? ` → ${apiBase}` : ''}`);
});
