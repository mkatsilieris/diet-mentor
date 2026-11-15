#!/usr/bin/env node
// Sets up Internet access for Diet Mentor on Cloudflare, the way Bill Split is published:
//   1. a Tunnel "diet-mentor" whose public hostname points at the web container (http://web:80)
//   2. the proxied CNAME record of that hostname
//   3. an Access application in front of it, with an "allow these e-mails" policy
// and writes ACCESS_TEAM_DOMAIN / ACCESS_AUD into cloudflare-access.env. The tunnel token (the one
// secret) is printed for the .env of the server.
//
//   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-setup.mjs --hostname diet.ninblack.com \
//       [--account <account id>] [--team-domain <team>.cloudflareaccess.com] [--emails a@x.gr,b@y.gr | --copy-emails-from <hostname or id of another Access app>]
//       [--claude]   also let https://<hostname>/api/mcp through Access, for Claude (the API checks a personal token)
//
// Token scopes (My Profile > API Tokens > Create Token > Custom):
//   Account > Cloudflare Tunnel: Edit, Account > Access: Apps and Policies: Edit, Zone > DNS: Edit
// Re-running is safe: the tunnel, the record and the application are found by name and reused.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail('Set CLOUDFLARE_API_TOKEN');

const args = parseArgs(process.argv.slice(2));
const hostname = args.hostname ?? fail('--hostname is required, e.g. --hostname diet.ninblack.com');
const tunnelName = args['tunnel-name'] ?? 'diet-mentor';
const appName = args['app-name'] ?? 'Diet Mentor';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) {
    const reason = data?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`${method} ${path}: ${reason}`);
  }
  return data.result;
}

// ---- account & zone ----
let account = args.account;
if (!account) {
  const accounts = await cf('GET', '/accounts');
  if (accounts.length !== 1) fail(`The token sees ${accounts.length} accounts, pass --account <id>: ${accounts.map((a) => `${a.name}=${a.id}`).join(', ')}`);
  account = accounts[0].id;
}
const zoneName = hostname.split('.').slice(-2).join('.');
const zones = await cf('GET', `/zones?name=${zoneName}`);
if (!zones[0]) fail(`Zone ${zoneName} not found (does the token have DNS: Edit on it?)`);
const zone = zones[0].id;
step(`account ${account}, zone ${zoneName}`);

// ---- tunnel ----
let tunnel = (await cf('GET', `/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}&is_deleted=false`))[0];
if (tunnel) step(`tunnel "${tunnelName}" exists (${tunnel.id})`);
else {
  tunnel = await cf('POST', `/accounts/${account}/cfd_tunnel`, { name: tunnelName, config_src: 'cloudflare' });
  step(`tunnel "${tunnelName}" created (${tunnel.id})`);
}
await cf('PUT', `/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`, {
  config: { ingress: [{ hostname, service: 'http://web:80' }, { service: 'http_status:404' }] },
});
step(`tunnel ingress: ${hostname} -> http://web:80`);
const tunnelToken = await cf('GET', `/accounts/${account}/cfd_tunnel/${tunnel.id}/token`);

// ---- DNS ----
const target = `${tunnel.id}.cfargotunnel.com`;
const records = await cf('GET', `/zones/${zone}/dns_records?name=${hostname}`);
const record = records[0];
if (!record) {
  await cf('POST', `/zones/${zone}/dns_records`, { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 });
  step(`DNS: CNAME ${hostname} -> ${target} created`);
} else if (record.type !== 'CNAME' || record.content !== target || !record.proxied) {
  await cf('PATCH', `/zones/${zone}/dns_records/${record.id}`, { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 });
  step(`DNS: ${hostname} updated -> ${target}`);
} else step(`DNS: ${hostname} already points at the tunnel`);

// ---- Access application ----
// The team domain (xxx.cloudflareaccess.com) needs the "Access: Organizations" scope to read; it can
// also be passed with --team-domain (it is the same for every application of the account).
let teamDomain = args['team-domain'];
if (!teamDomain) {
  try {
    teamDomain = (await cf('GET', `/accounts/${account}/access/organizations`)).auth_domain;
  } catch {
    fail('Could not read the Zero Trust team domain with this token: pass --team-domain <team>.cloudflareaccess.com');
  }
}
let app = (await cf('GET', `/accounts/${account}/access/apps`)).find((a) => a.domain === hostname);
if (app) step(`Access application "${app.name}" exists (${app.id})`);
else {
  app = await cf('POST', `/accounts/${account}/access/apps`, {
    name: appName,
    domain: hostname,
    type: 'self_hosted',
    session_duration: '720h',
    app_launcher_visible: true,
    auto_redirect_to_identity: false,
  });
  step(`Access application "${appName}" created (${app.id})`);
}

let emails = (args.emails ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
if (emails.length === 0 && args['copy-emails-from']) {
  // an application id, or the hostname of the application (bills.ninblack.com), which is easier to know
  let from = args['copy-emails-from'];
  if (from.includes('.')) {
    const other = (await cf('GET', `/accounts/${account}/access/apps`)).find((a) => a.domain === from);
    if (!other) fail(`No Access application found for ${from}`);
    from = other.id;
  }
  const src = await cf('GET', `/accounts/${account}/access/apps/${from}/policies`);
  emails = src.flatMap((p) => p.include ?? []).map((r) => r.email?.email).filter(Boolean);
  step(`copied ${emails.length} e-mail(s) from the policy of application ${args['copy-emails-from']}`);
}
const policies = await cf('GET', `/accounts/${account}/access/apps/${app.id}/policies`);
if (policies.length > 0) step(`policy "${policies[0].name}" already exists, left as is`);
else if (emails.length === 0) warn('no policy created: pass --emails or --copy-emails-from, or add one in Zero Trust > Access > Applications');
else {
  await cf('POST', `/accounts/${account}/access/apps/${app.id}/policies`, {
    name: 'Family',
    decision: 'allow',
    precedence: 1,
    include: emails.map((email) => ({ email: { email } })),
  });
  step(`policy "Family" created with ${emails.length} e-mail(s)`);
}

// ---- Claude (MCP) endpoint, only with --claude ----
// Claude is a program: it cannot type the one-time code of the Access login page. A second, more
// specific Access application lets requests to /api/mcp through Cloudflare without that login; the
// API itself then asks for a personal access token on every call (see docs/CLAUDE.md, README).
// Everything else on the hostname stays behind the Access login.
if (args.claude) {
  const mcpDomain = `${hostname}/api/mcp`;
  let mcpApp = (await cf('GET', `/accounts/${account}/access/apps`)).find((a) => a.domain === mcpDomain);
  if (mcpApp) step(`Access application "${mcpApp.name}" exists (${mcpApp.id})`);
  else {
    mcpApp = await cf('POST', `/accounts/${account}/access/apps`, {
      name: `${appName} - Claude (MCP)`,
      domain: mcpDomain,
      type: 'self_hosted',
      session_duration: '24h',
      app_launcher_visible: false,
    });
    step(`Access application "${mcpApp.name}" created (${mcpApp.id})`);
  }
  const mcpPolicies = await cf('GET', `/accounts/${account}/access/apps/${mcpApp.id}/policies`);
  if (mcpPolicies.length > 0) step(`policy "${mcpPolicies[0].name}" of ${mcpDomain} already exists, left as is`);
  else {
    await cf('POST', `/accounts/${account}/access/apps/${mcpApp.id}/policies`, {
      name: 'Token checked by the API',
      decision: 'bypass',
      precedence: 1,
      include: [{ everyone: {} }],
    });
    step(`policy "bypass" created for ${mcpDomain} (the API asks for a personal access token)`);
  }
}

// ---- files ----
const envPath = join(root, 'cloudflare-access.env');
let envText = readFileSync(envPath, 'utf8');
envText = envText.replace(/^ACCESS_TEAM_DOMAIN=.*$/m, `ACCESS_TEAM_DOMAIN=${teamDomain}`).replace(/^ACCESS_AUD=.*$/m, `ACCESS_AUD=${app.aud}`);
writeFileSync(envPath, envText);
step(`cloudflare-access.env updated (team domain ${teamDomain}, aud ${app.aud.slice(0, 8)}...)`);

console.log(`
Done. Put these in the .env of the server (never in git), then restart:

APP_URL=https://${hostname}
COMPOSE_PROFILES=internet
TUNNEL_TOKEN=${tunnelToken}
`);

function step(msg) {
  console.log(`✔ ${msg}`);
}
function warn(msg) {
  console.log(`! ${msg}`);
}
function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}
function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = list[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = 'true';
  }
  return out;
}
