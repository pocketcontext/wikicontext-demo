// Disposable public-demo policy. Production behaviour is unchanged unless
// WIKICONTEXT_DEMO_MODE=true. Every check fails closed.
const TERMS = 'wiki-demo-2026-10-10';
// Per-account daily limits. Counters live in demo_enrollments and are updated in
// the same transaction as the counted write, so concurrent requests cannot exceed them.
const LIMITS = {
 accounts: 200, writes: 2000,
 sources: 20, sourceBytes: 10485760, originalBytes: 26214400,
 renditions: 40, passages: 2000, textBytes: 2097152,
 runs: 60, pages: 100, pageRevisions: 300, publications: 40,
 citations: 3000, pageLinks: 1500,
};
const COUNTED = {sources: 'sources', renditions: 'renditions', passages: 'passages',
 ingestion_runs: 'runs', pages: 'pages', page_revisions: 'pageRevisions',
 citations: 'citations', page_links: 'pageLinks'};
// Text bytes cover caller-controlled prose and metadata, including mutable run text.
// IDs, fixed enums, generated manifests and audit/database overhead are separate.
const TEXT = {sources: ['title', 'original_name', 'media_type', 'source_date'],
 ingestion_runs: ['key', 'description', 'issue'], citations: ['note'], pages: ['slug'],
 passages: ['locator', 'body'], renditions: ['kind', 'processor', 'version_label', 'notes'],
 page_revisions: ['title', 'summary', 'body', 'properties', 'property_evidence']};
// Audio and audio-bearing video containers. The demo performs no transcription:
// there is no server-side Groq use, and client transcripts are rejected below.
const AUDIO_NAME = /\.(mp3|m4a|m4b|wav|flac|ogg|oga|opus|webm|weba|mp4|m4v|mpeg|mpg|mpga|aac|amr|aif|aiff|wma|3gp|mov|mkv|caf)$/i;
const AUDIO_TYPE = /^\s*(audio|video)\//i;
// Group spaces and memberships are not offered at launch. Unknown names never fire.
const SPACE_ADMIN = ['spaces', 'space_members', 'space_memberships', 'space_invitations'];
// Reviewed directory filters. With group spaces disabled, co-members are only the requester.
const DIRECTORY_FILTERS = [
 'id = :requester OR NOT EXISTS (SELECT 1 FROM demo_policy WHERE enabled = 1)',
 'user_directory.id = :requester OR EXISTS (SELECT 1 FROM space_members mine JOIN space_members other ON other.space = mine.space WHERE mine.account = :requester AND mine.active = 1 AND other.account = user_directory.id AND other.active = 1)',
];
const CLIENT_PIN = /wikicontext-client = \{ git = "https:\/\/github\.com\/pocketcontext\/wikicontext-demo\.git", rev = "([a-f0-9]{40})" \}/;

function enabled() {
 const value = $os.getenv('WIKICONTEXT_DEMO_MODE') || '';
 if (!['', 'false', 'true'].includes(value)) throw new Error('Invalid WIKICONTEXT_DEMO_MODE');
 return value === 'true';
}
function generation() {
 const value = $os.getenv('WIKICONTEXT_DEMO_GENERATION') || '';
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
  throw new Error('A valid demo UTC generation is required');
 return value;
}
// The stored generation, the environment and today's UTC date must all agree.
function current(app) {
 const day = generation(), policy = app.findRecordById('demo_policy', 'demopolicy00001');
 if (!policy.getBool('enabled') || policy.getString('generation') !== day || new Date().toISOString().slice(0, 10) !== day)
  throw new ApiError(503, 'The demo is resetting. Sign in again after reset.', {});
 return day;
}
function contactConfig() {
 const url = $os.getenv('WIKICONTEXT_DEMO_CONTACT_URL') || '';
 const token = $os.getenv('WIKICONTEXT_DEMO_CONTACT_TOKEN') || '';
 if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(url) || token.length < 32)
  throw new Error('Private demo contact service configuration is required');
 return {url, token};
}
function contacts(path, body) {
 const {url, token} = contactConfig();
 let response;
 try {
  response = $http.send({url: url + path, method: body === undefined ? 'GET' : 'POST',
   headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
   body: body === undefined ? undefined : JSON.stringify(body), timeout: 5});
 } catch (_) { throw new ApiError(503, 'Consent service unavailable; retry later.', {}); }
 if (response.statusCode === 409) throw new ApiError(409, 'Preferences changed; refresh and try again.', {});
 if (response.statusCode === 404 && body === undefined) return {revision: 0, salesContact: false, newsletter: false};
 if (response.statusCode < 200 || response.statusCode >= 300) throw new ApiError(503, 'Consent service unavailable; retry later.', {});
 return response.json;
}
function storageBoundary(app) {
 const fields = ['BUCKET', 'ENDPOINT', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];
 const prefixes = ['WIKICONTEXT_S3_', 'LITESTREAM_'];
 const remote = app.settings().s3.enabled || prefixes.some(prefix => fields.some(field => $os.getenv(prefix + field)));
 if (!remote) return; // Direct pinned-server local fixtures use isolated disk storage.
 for (const prefix of prefixes) {
  const required = prefix === 'LITESTREAM_' ? ['BUCKET', 'ENDPOINT', 'REGION'] : fields;
  if (required.some(field => !$os.getenv(prefix + field))) throw new Error('Demo requires complete dedicated primary and replica storage configuration');
  const chosen = prefix === 'WIKICONTEXT_S3_' ? 'pocketdeploy-v1-wikicontext-demo-files' : 'pocketdeploy-v1-wikicontext-demo-replica';
  const bucket = $os.getenv(prefix + 'BUCKET');
  if (bucket !== chosen && !/^wikicontext-demo-(?!contacts-)[a-z0-9][a-z0-9-]{1,40}$/.test(bucket))
   throw new Error('Demo storage requires dedicated wikicontext-demo buckets');
 }
 if ($os.getenv('WIKICONTEXT_S3_BUCKET') === $os.getenv('LITESTREAM_BUCKET') ||
     ($os.getenv('LITESTREAM_ACCESS_KEY_ID') && $os.getenv('WIKICONTEXT_S3_ACCESS_KEY_ID') === $os.getenv('LITESTREAM_ACCESS_KEY_ID')))
  throw new Error('Demo primary and replica storage require separate buckets and credentials');
 if (app.settings().s3.enabled && app.settings().s3.bucket !== $os.getenv('WIKICONTEXT_S3_BUCKET'))
  throw new Error('Stored demo storage differs from its dedicated configuration');
}
function bootstrap(app) {
 const active = enabled();
 let policy; try { policy = app.findRecordById('demo_policy', 'demopolicy00001'); } catch (_) { policy = null; }
 if (!active) {
  if (policy && policy.getBool('enabled')) throw new Error('A demo database cannot run in production mode');
  return;
 }
 const day = generation();
 storageBoundary(app);
 if (policy && !policy.getBool('enabled')) {
  // A production database is never converted into a public demo.
  if (app.countRecords('users') || app.countRecords('sources')) throw new Error('Demo requires a fresh isolated database');
  policy.set('enabled', true); policy.set('generation', day); app.save(policy);
 }
 if (policy) current(app);
 if (app.store().get('pocketcontextMaintenanceReadOnly') === true) return;
 // Passwords, OTP and email mutations must not offer alternate Google admission.
 const users = app.findCollectionByNameOrId('users');
 users.passwordAuth.enabled = false; users.otp.enabled = false; app.save(users);
 // A public demo must never silently start without abuse protection.
 const settings = app.settings(); settings.rateLimits.enabled = true;
 settings.rateLimits.rules = require(`${__hooks}/deploy.js`).RULES; app.save(settings);
 contactConfig();
}
function contextConfigPath() {
 let path = 'pocketcontext.json';
 const args = $os.args;
 for (let i = 0; i < args.length; i++) {
  if (args[i] === '--contextConfig') path = args[++i];
  else if (args[i].startsWith('--contextConfig=')) path = args[i].slice(16);
 }
 return path;
}
// Shared-workspace SQL would expose every visitor's wiki. Demo mode requires
// requester-filtered snapshots for every exposed table, a reviewed private
// directory filter, and hidden account and demo tables.
function checkConfig() {
 if (!enabled()) return;
 const config = JSON.parse(toString($os.readFile(contextConfigPath())));
 const snapshot = config.snapshot, filters = snapshot && snapshot.filters, tables = config.tables || {};
 if (!filters || !DIRECTORY_FILTERS.includes(filters.user_directory) || !tables.user_directory ||
     tables.demo_policy || tables.demo_enrollments || tables.users ||
     Object.keys(tables).some(table => typeof filters[table] !== 'string' || !filters[table].includes(':requester')))
  throw new Error('Demo requires its private filtered-snapshot SQL policy');
}
function publicInstallation() {
 // The packaged repository launcher is the single source of the tested client pin.
 // Read only this fixed public source file; never execute it.
 try {
  const bytes = $os.readFile('skills/wikicontext/wikicontext');
  if (bytes.length > 4096) return false;
  const text = toString(bytes), match = CLIENT_PIN.exec(text);
  // Exactly one pin: a second source line would make the tested revision ambiguous.
  if (!match || text.split('wikicontext-client = {').length !== 2) return false;
  return {method: 'skills', source: 'https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext',
   skill: 'wikicontext', clientRevision: match[1]};
 } catch (_) { return false; }
}
function status(e) {
 e.response.header().set('Cache-Control', 'no-store');
 if (!enabled()) return e.json(200, {enabled: false});
 const day = current(e.app), installation = publicInstallation();
 return e.json(200, {enabled: true, clientReady: !!installation, installation: installation || null, generation: day,
  resetAt: new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString(), termsVersion: TERMS, consentVersion: TERMS,
  limits: LIMITS, restrictions: {personalSpaceOnly: true, groupSpaces: false, audioSources: false, transcription: false}});
}
function subject(app, account) {
 const links = app.findRecordsByFilter('_externalAuths', 'recordRef = {:a} && provider = "google"', '', 1, 0, {a: account.id});
 if (!links.length) throw new ForbiddenError('Google demo identity required.');
 return links[0].getString('providerId');
}
function actor(e) {
 if (!enabled()) throw new NotFoundError('Demo unavailable.');
 current(e.app);
 if (!e.auth || e.auth.collection().name !== 'users' || e.auth.getBool('disabled')) throw new UnauthorizedError('Sign in with Google first.');
 const account = e.app.findRecordById('users', e.auth.id);
 subject(e.app, account);
 return account;
}
function preferences(e) {
 const account = actor(e); e.response.header().set('Cache-Control', 'no-store');
 return e.json(200, contacts('/preferences?subject=' + encodeURIComponent(subject(e.app, account))));
}
function enrollmentRow(app, account) {
 const rows = app.findRecordsByFilter('demo_enrollments', 'account = {:a}', '', 1, 0, {a: account});
 return rows.length ? rows[0] : null;
}
function enrollmentStatus(e) {
 const account = actor(e), day = current(e.app), row = enrollmentRow(e.app, account.id);
 const valid = !!row && row.getString('generation') === day && row.getString('terms_version') === TERMS;
 e.response.header().set('Cache-Control', 'no-store');
 return e.json(200, {enrolled: valid, generation: day, termsVersion: TERMS,
  space: valid ? row.getString('space') || null : null, usage: valid ? usage(row) : null});
}
// Integration point owned by the spaces data model. Without it the demo would
// fall back to a shared workspace, so enrollment fails closed.
function personalSpace(app, account) {
 let spaces;
 try { spaces = require(`${__hooks}/spaces.js`); } catch (_) { spaces = null; }
 if (!spaces || typeof spaces.ensurePersonalSpace !== 'function')
  throw new ApiError(503, 'Personal wiki spaces are unavailable; enrollment is closed.', {});
 const id = spaces.ensurePersonalSpace(app, account);
 if (typeof id !== 'string' || !/^[a-z0-9]{15}$/.test(id)) throw new ApiError(503, 'Personal wiki space could not be prepared.', {});
 return id;
}
function enroll(e) {
 const account = actor(e), body = e.requestInfo().body, day = current(e.app);
 if (body.generation !== day || body.termsVersion !== TERMS || body.acceptTerms !== true ||
     typeof body.salesConsent !== 'boolean' || typeof body.newsletterConsent !== 'boolean' ||
     !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
  throw new BadRequestError('Accept the current demo terms and choose each optional consent explicitly.');
 const contact = contacts('/enroll', {subject: subject(e.app, account), email: account.getString('email'),
  salesContact: body.salesConsent, newsletter: body.newsletterConsent, termsVersion: TERMS, consentVersion: TERMS,
  expectedRevision: body.expectedRevision});
 // Record an enrollment attempt using PocketBase's canonical peer/trusted-proxy
 // result. Consent and this event commit independently of wiki enrollment; neither
 // proves that the following transaction succeeded. Failure leaves access closed.
 if (!enrollmentRow(e.app, account.id)) contacts('/security', {event: 'enrollment', ip: e.realIP(), timestamp: Math.floor(Date.now() / 1000)});
 let space = '';
 e.app.runInTransaction(app => {
  current(app);
  const existing = enrollmentRow(app, account.id);
  const row = existing || new Record(app.findCollectionByNameOrId('demo_enrollments'));
  space = personalSpace(app, account.id);
  row.set('account', account.id); row.set('generation', day); row.set('terms_version', TERMS);
  row.set('sales_consent', body.salesConsent); row.set('newsletter_consent', body.newsletterConsent);
  row.set('contact_revision', contact.revision); row.set('space', space);
  if (!existing) row.set('usage', {});
  app.save(row);
 });
 e.response.header().set('Cache-Control', 'no-store');
 return e.json(200, {enrolled: true, generation: day, termsVersion: TERMS, space, contact});
}
function unsubscribe(e) {
 if (!enabled()) throw new NotFoundError('Demo unavailable.');
 const body = e.requestInfo().body;
 if (typeof body.token !== 'string' || body.token.length > 256 || body.token.length < 20) throw new BadRequestError('Invalid withdrawal token.');
 e.response.header().set('Cache-Control', 'no-store');
 return e.json(200, contacts('/unsubscribe', {token: body.token}));
}
function enrollment(app, account) {
 const day = current(app), row = enrollmentRow(app, account);
 if (!row || row.getString('generation') !== day || row.getString('terms_version') !== TERMS)
  throw new ForbiddenError('Accept the demo terms before using the wiki.');
 return row;
}
function usage(row) {
 let value;
 try { value = JSON.parse(row.getString('usage') || '{}'); } catch (_) { value = null; }
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid demo usage counters');
 return value;
}
function bump(counters, key, amount) {
 const next = (Number.isInteger(counters[key]) ? counters[key] : 0) + amount;
 if (next > LIMITS[key]) throw new ApiError(429, 'Demo quota reached: ' + key + '.', {limit: LIMITS[key]});
 counters[key] = next;
}
function utf8(value) {
 let bytes = 0;
 for (let i = 0; i < value.length; i++) {
  const code = value.charCodeAt(i);
  if (code < 0x80) bytes += 1;
  else if (code < 0x800) bytes += 2;
  else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) { bytes += 4; i++; }
  else bytes += 3;
 }
 return bytes;
}
function unsavedFiles(record) {
 try { return record.getUnsavedFiles('original') || []; } catch (_) { return []; }
}
// Request-stage content policy. Runs for users and superusers alike.
function content(e) {
 const record = e.record, name = record.collection().name;
 if (name === 'sources') {
  const names = [record.getString('original_name'), ...unsavedFiles(record).map(file => String(file.originalName || ''))];
  if (AUDIO_TYPE.test(record.getString('media_type')) || names.some(value => AUDIO_NAME.test(value)))
   throw new BadRequestError('Audio and video sources are unavailable in this disposable demo.');
  if (unsavedFiles(record).some(file => file.size > LIMITS.sourceBytes))
   throw new ApiError(413, 'Demo sources are limited to 10 MiB each.', {});
 }
 if (name === 'renditions' && (record.getString('kind') === 'transcript' || /groq|whisper|transcri/i.test(record.getString('processor'))))
  throw new BadRequestError('Audio transcription is unavailable in this disposable demo.');
}
function recordRequest(e) {
 if (!enabled()) return e.next();
 current(e.app);
 if (e.auth && e.auth.collection().name === 'users') enrollment(e.app, e.auth.id);
 content(e);
 return e.next();
}
// Execute-stage quota accounting inside the write transaction opened by integrity.js.
function recordExecute(e) {
 if (!enabled()) return;
 const record = e.record, name = record.collection().name, fresh = record.isNew();
 // integrity.js marks each REST write for its audit entry before saving. Server-internal
 // saves (for example the source checksum update) carry no marker and are not counted.
 if (!record.getString('_audit_actor')) return;
 const account = record.getString(fresh ? 'created_by' : 'updated_by');
 if (account) {
  const row = enrollment(e.app, account), counters = usage(row);
  bump(counters, 'writes', 1);
  if (fresh) {
   bump(counters, COUNTED[name], 1);
   if (name === 'sources') {
    const files = unsavedFiles(record);
    if (files.some(file => file.size > LIMITS.sourceBytes)) throw new ApiError(413, 'Demo sources are limited to 10 MiB each.', {});
    bump(counters, 'originalBytes', files.reduce((total, file) => total + file.size, 0));
   }
  } else if (name === 'ingestion_runs' && record.getString('status') === 'published' &&
             record.original().getString('status') !== 'published') {
   bump(counters, 'publications', 1);
  }
  if (TEXT[name]) {
   // Charge new text and positive growth on updates; shrinking fields never refunds
   // earlier usage. Status-only publication must not charge unchanged prose again.
   const previous = fresh ? null : record.original();
   const added = TEXT[name].reduce((total, field) => total + Math.max(0,
    utf8(record.getString(field)) - (previous ? utf8(previous.getString(field)) : 0)), 0);
   bump(counters, 'textBytes', added);
  }
  row.set('usage', counters); e.app.save(row);
 }
}
function spaceAdministration(e) {
 if (enabled() && !(e.auth && e.auth.isSuperuser()))
  throw new ForbiddenError('Group spaces and memberships are unavailable in this disposable demo.');
 return e.next();
}
// Exempt only Google sign-in, the caller's own account record and demo routes.
function exempt(path, method, account) {
 if (method === 'GET' && ['/api/demo/status', '/api/demo/preferences', '/api/demo/enrollment',
     '/api/collections/users/auth-methods', '/api/oauth2-redirect'].includes(path)) return true;
 if (method === 'POST' && ['/api/demo/enroll', '/api/demo/unsubscribe',
     '/api/collections/users/auth-with-oauth2', '/api/collections/users/auth-refresh'].includes(path)) return true;
 return method === 'GET' && path === '/api/collections/users/records/' + account;
}
function guard(e) {
 if (!enabled()) return e.next();
 // Static pages remain available while all demo API traffic fails closed.
 const path = e.request.url.path;
 if ((path.startsWith('/api/') && path !== '/api/demo/unsubscribe') || path === '/up') current(e.app);
 if (e.auth && e.auth.collection().name === 'users' && path.startsWith('/api/') && !exempt(path, e.request.method, e.auth.id)) enrollment(e.app, e.auth.id);
 return e.next();
}
function realtime(e) {
 if (!enabled()) return e.next();
 if (e.message.name === 'PB_CONNECT' || e.message.name === '@oauth2') return e.next();
 try {
  current(e.app);
  const auth = e.client.get('auth');
  if (auth && auth.collection().name === 'users') enrollment(e.app, auth.id);
 } catch (_) { return; }
 return e.next();
}
function rejectAlternativeAuth(e) {
 if (enabled()) throw new ForbiddenError('The public demo uses Google sign-in only; account credential changes are unavailable.');
 return e.next();
}
function userCreate(e) {
 if (!enabled()) return e.next();
 current(e.app);
 e.app.runInTransaction(app => {
  if (app.countRecords('users') >= LIMITS.accounts) throw new ApiError(429, 'Demo account quota reached.', {});
  const original = e.app; e.app = app; try { e.next(); } finally { e.app = original; }
 });
}
// Static legal drafts. Served only in demo mode, with the reader's strict headers.
function legal(e, file) {
 if (!enabled()) throw new NotFoundError();
 const h = e.response.header();
 h.set('Cache-Control', 'no-store');
 h.set('Referrer-Policy', 'no-referrer');
 h.set('X-Content-Type-Options', 'nosniff');
 h.set('X-Frame-Options', 'DENY');
 h.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
 return e.fileFS($os.dirFS('legal'), file);
}
module.exports = {TERMS, LIMITS, COUNTED, SPACE_ADMIN, DIRECTORY_FILTERS, enabled, current, bootstrap, checkConfig,
 status, preferences, enrollmentStatus, enroll, unsubscribe, recordRequest, recordExecute, spaceAdministration,
 guard, realtime, rejectAlternativeAuth, userCreate, legal};
