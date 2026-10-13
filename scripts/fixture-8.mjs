import { fixtureRequests } from './fixture-7.mjs';

export function zoneFixtures() {
  const normal = fixtureRequests().normal;
  const own = normal.path;
  const foreign = own.replace('/learner_fixture/', '/another_learner/');
  const notice = '/announcements/88888888-8888-4888-8888-888888888888';
  const item = (name, changes, decision) => ({ name, request: { ...normal, ...changes }, decision });
  return [
    item('self_note_read', {}, 'allow'),
    item('self_note_edit', { method: 'PUT', route: 'PUT /notes/owners/:ownerId/:id' }, 'allow'),
    item('foreign_note_read', { path: foreign }, 'deny'),
    item('foreign_note_edit', { path: foreign, method: 'PUT', route: 'PUT /notes/owners/:ownerId/:id' }, 'deny'),
    item('foreign_note_list', { path: '/notes/owners/another_learner', route: 'GET /notes/owners/:ownerId' }, 'deny'),
    item('self_note_list', { path: '/notes/owners/learner_fixture', route: 'GET /notes/owners/:ownerId' }, 'allow'),
    item('student_notice_edit', { path: notice, method: 'PUT', route: 'PUT /announcements/:id' }, 'deny'),
    item('authenticated_notice_read', { path: notice, route: 'GET /announcements/:id' }, 'allow'),
    item('unknown_resource_path', { path: '/notes/export', route: 'GET /notes/:id' }, 'deny'),
    item('query_operation_switch', { queryLength: 11, querySha256: 'a'.repeat(64) }, 'deny'),
  ];
}

export async function checkZones(decide) {
  return Promise.all(zoneFixtures().map(async ({ name, request, decision }) => {
    const output = await decide(request);
    const passed = output?.decision === decision && output.requestId === request.requestId
      && output.schema === 'aleph.decision.v1'
      && Object.keys(output).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema';
    return { name, passed, decision: output?.decision, reasonCode: output?.reasonCode };
  }));
}
