// Synthetic metadata only. No credentials, note bodies, IP addresses or names.
export const START = Date.UTC(2026, 9, 1, 0, 0, 0);
export const SUBJECT = 'learner_fixture';
export const DEVICE = 'aaaaaaaaaaaaaaaa';
export const proposal = (subject = SUBJECT, deviceId = DEVICE) => ({
  action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId,
});
export function reads(count, { intervalMs = 2000, start = START, subjectId = SUBJECT,
  deviceId = DEVICE, network = 'unusual', source = 'judge_fixture',
  method = 'GET', deviceRegistered = true, decision = 'allow', requestOffset = 0 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(start + index * intervalMs).toISOString(),
    requestId: `00000000-0000-4000-8000-${(requestOffset + index).toString(16).padStart(12, '0')}`,
    classId: 'class_fixture', projectId: 'project_fixture', subjectId, deviceId,
    deviceRegistered, method, decision, signals: { source, network },
  }));
}
const observe = { action: 'observe' };
const legacy = events => events.map(({ at, method, subjectId }) => ({ at, method, identity: { sub: subjectId } }));
const legacyProposal = { action: 'propose_revocation', reasonCode: 'burst_read', subject: SUBJECT };
export function detectionFixtures() {
  return [
    { name: 'normal_reads', group: 'normal', events: reads(30, { network: 'usual' }), expected: observe },
    { name: 'usual_network_burst', group: 'normal', events: reads(200, { network: 'usual' }), expected: observe },
    { name: 'unusual_network_only', group: 'normal', events: reads(30), expected: observe },
    { name: 'region_only', group: 'normal', events: reads(200, { network: 'usual' }).map(event =>
      ({ ...event, signals: { ...event.signals, region: 'foreign' } })), expected: observe },
    { name: 'exact_120', group: 'boundary', events: reads(120), expected: observe },
    { name: 'compound_121', group: 'compound', events: reads(121), expected: proposal() },
    { name: 'compound_200', group: 'compound', events: reads(200), expected: proposal() },
    { name: 'inclusive_10_minutes', group: 'boundary', events: reads(121, { intervalMs: 5000 }), expected: proposal() },
    { name: 'outside_10_minutes', group: 'boundary', events: reads(121, { intervalMs: 5001 }), expected: observe },
    { name: 'out_of_order', group: 'compound', events: reads(121).reverse(), expected: proposal() },
    { name: 'sliding_window', group: 'boundary', events: [
      ...reads(1, { start: START - 600001, requestOffset: 1000 }), ...reads(121),
    ], expected: proposal() },
    { name: 'separate_users', group: 'boundary', events: [
      ...reads(100), ...reads(100, { subjectId: 'other_fixture', requestOffset: 1000 }),
    ], expected: observe },
    { name: 'separate_devices', group: 'boundary', events: [
      ...reads(100), ...reads(100, { deviceId: 'bbbbbbbbbbbbbbbb', requestOffset: 1000 }),
    ], expected: observe },
    { name: 'normal_device_kept', group: 'compound', events: [
      ...reads(200, { deviceId: 'bbbbbbbbbbbbbbbb', network: 'usual', requestOffset: 1000 }), ...reads(121),
    ], expected: proposal() },
    { name: 'non_get_burst', group: 'normal', events: reads(200, { method: 'POST' }), expected: observe },
    { name: 'duplicate_requests', group: 'boundary', events: Array.from({ length: 200 }, () => reads(1)[0]), expected: observe },
    { name: 'unregistered_device', group: 'normal', events: reads(200, { deviceRegistered: false }), expected: observe },
    { name: 'browser_signals', group: 'normal', events: reads(200, { source: 'browser' }), expected: observe },
    { name: 'unknown_network', group: 'normal', events: reads(200, { network: 'unknown', source: 'none' }), expected: observe },
    // These six cases reproduce the published starter's detection exercise,
    // independent of the optional decision-request metadata used above.
    { name: 'official_legacy_normal_30', group: 'normal', events: legacy(reads(30)), expected: observe },
    { name: 'official_legacy_exact_120', group: 'boundary', events: legacy(reads(120)), expected: observe },
    { name: 'official_legacy_burst_121', group: 'compound', events: legacy(reads(121)), expected: legacyProposal },
    { name: 'official_legacy_burst_200', group: 'compound', events: legacy(reads(200)), expected: legacyProposal },
    { name: 'official_legacy_separate_users', group: 'boundary', events: legacy([
      ...reads(100), ...reads(100, { subjectId: 'other_fixture' }),
    ]), expected: observe },
    { name: 'official_legacy_outside_10_minutes', group: 'boundary', events: legacy(reads(200, { intervalMs: 7000 })), expected: observe },
    { name: 'mixed_read_decisions', group: 'compound', events: reads(121).map((event, index) =>
      ({ ...event, decision: ['allow', 'deny', 'step_up'][index % 3] })), expected: proposal() },
    { name: 'resource_switch', group: 'compound', events: reads(121).map((event, index) =>
      ({ ...event, path: index % 2 ? '/notes/example' : '/announcements/example' })), expected: proposal() },
  ];
}
