/// <reference path="../pb_data/types.d.ts" />
// Public-demo admission, consent, quotas and daily-generation guards. Logic is in demo.js.
onBootstrap((e) => {
 e.next();
 require(`${__hooks}/demo.js`).bootstrap(e.app);
 require(`${__hooks}/demo.js`).checkConfig();
});
// After account_access.js (-1019) has rejected revoked sessions.
routerUse(new Middleware((e) => require(`${__hooks}/demo.js`).guard(e), -1018));
routerAdd('GET', '/api/demo/status', (e) => require(`${__hooks}/demo.js`).status(e));
routerAdd('GET', '/api/demo/preferences', (e) => require(`${__hooks}/demo.js`).preferences(e));
routerAdd('GET', '/api/demo/enrollment', (e) => require(`${__hooks}/demo.js`).enrollmentStatus(e));
routerAdd('POST', '/api/demo/enroll', (e) => require(`${__hooks}/demo.js`).enroll(e));
routerAdd('POST', '/api/demo/unsubscribe', (e) => require(`${__hooks}/demo.js`).unsubscribe(e));
routerAdd('GET', '/terms/', (e) => require(`${__hooks}/demo.js`).legal(e, 'terms.html'));
routerAdd('GET', '/privacy/', (e) => require(`${__hooks}/demo.js`).legal(e, 'privacy.html'));
routerAdd('GET', '/legal/legal.css', (e) => require(`${__hooks}/demo.js`).legal(e, 'legal.css'));
onRealtimeMessageSend((e) => require(`${__hooks}/demo.js`).realtime(e));

// Domain writes: enrollment and content policy at request time, quotas inside the write transaction.
onRecordCreateRequest((e) => require(`${__hooks}/demo.js`).recordRequest(e),
 'sources', 'renditions', 'passages', 'ingestion_runs', 'pages', 'page_revisions', 'citations', 'page_links');
onRecordUpdateRequest((e) => require(`${__hooks}/demo.js`).recordRequest(e),
 'sources', 'renditions', 'passages', 'ingestion_runs', 'pages', 'page_revisions', 'citations', 'page_links');
// integrity.js invokes quota accounting before consuming its audit marker.
// Group spaces are disabled at launch; personal spaces are created only by enrollment.
onRecordCreateRequest((e) => require(`${__hooks}/demo.js`).spaceAdministration(e),
 'spaces', 'space_members', 'space_memberships', 'space_invitations');
onRecordUpdateRequest((e) => require(`${__hooks}/demo.js`).spaceAdministration(e),
 'spaces', 'space_members', 'space_memberships', 'space_invitations');
onRecordDeleteRequest((e) => require(`${__hooks}/demo.js`).spaceAdministration(e),
 'spaces', 'space_members', 'space_memberships', 'space_invitations');

onRecordCreateExecute((e) => require(`${__hooks}/demo.js`).userCreate(e), 'users');
onRecordAuthWithPasswordRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordAuthWithOTPRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordRequestOTPRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordRequestPasswordResetRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordConfirmPasswordResetRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordRequestEmailChangeRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordConfirmEmailChangeRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
onRecordRequestVerificationRequest((e) => require(`${__hooks}/demo.js`).rejectAlternativeAuth(e), 'users');
