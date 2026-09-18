import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [emailFile, previewUrl, validityDays = '30'] = process.argv.slice(2);
const secret = process.env.ORIGINS_LINK_SECRET || '';

if (!emailFile || !previewUrl) {
  console.error('Usage: ORIGINS_LINK_SECRET="..." node scripts/generate-origins-links.mjs origins-emails.txt https://origins-preview.your-domain.com [validity-days]');
  process.exit(1);
}

if (secret.length < 32) {
  console.error('ORIGINS_LINK_SECRET must be at least 32 characters. Store it in the host environment, never in the code.');
  process.exit(1);
}

const days = Number(validityDays);
if (!Number.isFinite(days) || days <= 0) {
  console.error('Validity days must be a positive number.');
  process.exit(1);
}

const emails = [...new Set((await readFile(emailFile, 'utf8'))
  .split(/[\r\n,]+/)
  .map(value => value.trim().toLowerCase())
  .filter(value => value && value !== 'email'))];

if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  console.error('The input must contain valid email addresses, one per line.');
  process.exit(1);
}

const expiry = Math.floor(Date.now() / 1000) + Math.round(days * 24 * 60 * 60);
const csv = value => `"${String(value).replaceAll('"', '""')}"`;

console.log('EMAIL,ORIGINS_PREVIEW_URL');
for (const email of emails) {
  const payload = Buffer.from(JSON.stringify({ email, cohort: 'origins', exp: expiry })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  const url = new URL(previewUrl);
  url.searchParams.set('origin', `${payload}.${signature}`);
  console.log(`${csv(email)},${csv(url)}`);
}
