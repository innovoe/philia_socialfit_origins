import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';

const html = await readFile(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 3000);

const accessSecret = process.env.ORIGINS_LINK_SECRET || '';
const gateDisabled = process.env.ORIGINS_GATE_DISABLED === 'true';
const cookieName = 'socialfit_origins_access';

function sign(payload) {
  return createHmac('sha256', accessSecret).update(payload).digest('base64url');
}

function safelyEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyAccessToken(token) {
  if (!accessSecret || typeof token !== 'string') return null;
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

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return index === -1 ? [value, ''] : [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
  }));
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
}

function privatePage(message) {
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>SocialFit Origins Preview</title>
<style>:root{--ink:#202034;--paper:#FFFDF9;--canvas:#FBF8F7;--panel:#F2ECE5;--line:#E8E0D9;--accent:#B30D12}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink);font-family:Inter,Arial,sans-serif}.card{width:min(620px,100%);padding:58px 52px;background:var(--paper);border:1px solid var(--line);border-radius:28px;box-shadow:0 18px 50px rgba(32,32,52,.06);text-align:center}.eyebrow{font:700 9px/1.6 Montserrat,Arial,sans-serif;letter-spacing:1.7px;text-transform:uppercase;color:var(--accent)}h1{margin:18px 0 0;font:400 48px/1.02 'Cormorant Garamond',Georgia,serif;letter-spacing:-1px}p{margin:25px auto 0;max-width:450px;font-size:14px;line-height:1.8;color:#56545A}.fine{font-size:11px;color:#6F6C69}.mark{margin-bottom:42px;font:700 26px/1 Montserrat,Arial,sans-serif;letter-spacing:-1.2px}.mark small{display:block;margin-top:9px;font:500 9px/1.5 Inter,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase}@media(max-width:600px){.card{padding:46px 27px;border-radius:22px}h1{font-size:40px}}</style></head>
<body><main class="card"><div class="mark">socialfit<small>by Philia Life</small></div><div class="eyebrow">For Origins eyes only</div><h1>This is a private<br>first look.</h1><p>${message}</p><p class="fine">Dubai First Wave. Personal invitation required.</p></main></body></html>`);
}

if (!accessSecret && !gateDisabled) {
  console.warn('Origins gate is closed: set ORIGINS_LINK_SECRET before sharing the preview.');
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {'Allow':'GET, HEAD'}); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/health') {
    res.writeHead(200, {...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : 'ok');
    return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!['/', '/index.html'].includes(pathname)) { res.writeHead(404); res.end('Not found'); return; }

  const linkToken = url.searchParams.get('origin');
  const claims = verifyAccessToken(linkToken);
  if (claims) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const secure = forwardedProto === 'https' || process.env.NODE_ENV === 'production';
    const secondsLeft = Math.max(60, Math.min(7 * 24 * 60 * 60, claims.exp - Math.floor(Date.now() / 1000)));
    const cookie = `${cookieName}=${encodeURIComponent(linkToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${secondsLeft}${secure ? '; Secure' : ''}`;
    res.writeHead(302, {...securityHeaders('text/plain; charset=utf-8'), 'Cache-Control':'no-store', 'Set-Cookie':cookie, 'Location':'/'});
    res.end();
    return;
  }

  const sessionClaims = verifyAccessToken(cookies(req)[cookieName]);
  if (!gateDisabled && !sessionClaims) {
    const body = privatePage(accessSecret
      ? 'Open this preview using the personal link in your Origins welcome email. If the link has expired, ask the SocialFit team for a fresh invitation.'
      : 'This private preview is not open yet. Please return when your personal Origins invitation arrives.');
    res.writeHead(403, {...securityHeaders('text/html; charset=utf-8'), 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(200, {...securityHeaders('text/html; charset=utf-8'), 'Cache-Control':'private, no-store'});
  res.end(req.method === 'HEAD' ? undefined : html);
}).listen(port, '0.0.0.0', () => console.log(`SocialFit demo listening on port ${port}`));
