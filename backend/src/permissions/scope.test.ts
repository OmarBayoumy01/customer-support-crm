import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isUnrestricted, ticketScopeWhere, type ScopeContext } from './scope.js';

const context: ScopeContext = { userId: 'user-1', departmentId: 'dept-1' };
const noDepartment: ScopeContext = { userId: 'user-1', departmentId: null };

test('ALL adds no filter', () => {
  assert.deepEqual(ticketScopeWhere(['ALL'], context), {});
  assert.equal(isUnrestricted(['ALL']), true);
});

test('ALL wins over anything narrower', () => {
  // There is no answer narrower than "everything", so OR-ing is pointless.
  assert.deepEqual(ticketScopeWhere(['ASSIGNED', 'ALL', 'OWN'], context), {});
});

test('ASSIGNED narrows to the user’s queue', () => {
  assert.deepEqual(ticketScopeWhere(['ASSIGNED'], context), { assigneeId: 'user-1' });
});

test('TEAM narrows to the user’s department', () => {
  assert.deepEqual(ticketScopeWhere(['TEAM'], context), { departmentId: 'dept-1' });
});

test('OWN reaches through the customer record the login is linked to', () => {
  assert.deepEqual(ticketScopeWhere(['OWN'], context), { customer: { userId: 'user-1' } });
});

test('several scopes are OR-ed, because holding both means both', () => {
  assert.deepEqual(ticketScopeWhere(['ASSIGNED', 'OWN'], context), {
    OR: [{ assigneeId: 'user-1' }, { customer: { userId: 'user-1' } }],
  });
});

test('no scopes matches nothing — never everything', () => {
  const where = ticketScopeWhere([], context);

  assert.deepEqual(where, { id: { in: [] } });
  assert.notDeepEqual(where, {}, 'an empty filter would hand out the entire table');
});

test('TEAM for a user with no department matches nothing', () => {
  // A portal customer has no department. Matching every ticket whose
  // departmentId is null would be a quiet, total disclosure.
  assert.deepEqual(ticketScopeWhere(['TEAM'], noDepartment), { id: { in: [] } });
});

test('TEAM plus a usable scope still yields the usable one', () => {
  assert.deepEqual(ticketScopeWhere(['TEAM', 'ASSIGNED'], noDepartment), {
    assigneeId: 'user-1',
  });
});

test('isUnrestricted is false for anything scoped', () => {
  assert.equal(isUnrestricted(['TEAM', 'ASSIGNED', 'OWN']), false);
  assert.equal(isUnrestricted([]), false);
});
