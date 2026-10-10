/// <reference path="../pb_data/types.d.ts" />
// Ordinary users cannot create spaces or change membership in this phase; the
// collection rules are superuser-only and these handlers validate trusted fixtures.
onRecordCreateRequest((e) => require(`${__hooks}/spaces.js`).createRequest(e), 'spaces', 'space_members');
onRecordUpdateRequest((e) => require(`${__hooks}/spaces.js`).updateRequest(e), 'spaces', 'space_members');
onRecordDeleteRequest((e) => { throw new ForbiddenError('Spaces and memberships are retained; deactivate a membership instead.'); }, 'spaces', 'space_members');
