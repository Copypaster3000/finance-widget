import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
const blockedNames = /^(?:portfolio(?:\..+)?\.json|\.env(?:\..+)?|.+\.(?:key|pem|pfx|p12|log|bak))$/i;
const emailPattern = /\b[A-Z][A-Z0-9._%+-]*@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const windowsUserPath = /[A-Z]:\\Users\\([^\\\r\n]+)\\/gi;
const unixUserPath = /\/(?:Users|home)\/([^/\s]+)\//gi;

for (const file of files) {
  if (blockedNames.test(basename(file)) && file !== '.env.example') {
    findings.push(`${file}: sensitive filename must not be tracked`);
  }

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    findings.push(`${file}: private-key material detected`);
  }

  for (const email of content.match(emailPattern) ?? []) {
    if (!/@(?:users\.noreply\.github\.com|example\.(?:com|org|net))$/i.test(email)) {
      findings.push(`${file}: public email-like value detected (${email})`);
    }
  }

  for (const match of content.matchAll(windowsUserPath)) {
    if (!['<user>', '$env:USERNAME'].includes(match[1])) {
      findings.push(`${file}: personal Windows user path detected`);
    }
  }

  for (const match of content.matchAll(unixUserPath)) {
    if (!['<user>', '$USER', 'runner'].includes(match[1])) {
      findings.push(`${file}: personal Unix user path detected`);
    }
  }
}

if (findings.length) {
  console.error('Public-data check failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Public-data check passed (${files.length} tracked files scanned).`);
