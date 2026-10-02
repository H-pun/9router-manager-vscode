import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSettings, diffToServerPatch, fromServer } from '../tokenSaverMapping';

test('fromServer applies defaults and merges enabled+level', () => {
  const v = fromServer({ rtkEnabled: false, cavemanLevel: 'ultra', ponytailEnabled: true, ponytailLevel: 'ultra' });
  assert.equal(v.rtk, false);
  assert.equal(v.caveman, 'off');
  assert.equal(v.ponytail, 'ultra');
  assert.equal(v.headroomUrl, 'http://localhost:8787');
});

test('fromServer falls back to default level for invalid enum', () => {
  assert.equal(fromServer({ cavemanEnabled: true, cavemanLevel: 'bogus' }).caveman, 'full');
});

test('diffToServerPatch only includes changed fields', () => {
  const server = fromServer({});
  assert.equal(diffToServerPatch({ ...server }, server), undefined);
  assert.deepEqual(diffToServerPatch({ ...server, rtk: false, caveman: 'ultra' }, server), {
    rtkEnabled: false,
    cavemanEnabled: true,
    cavemanLevel: 'ultra',
  });
});

test('diffToServerPatch: level change while on, and turning off', () => {
  const server = fromServer({ cavemanEnabled: true, cavemanLevel: 'lite' });
  assert.deepEqual(diffToServerPatch({ caveman: 'ultra' }, server), { cavemanLevel: 'ultra' });
  assert.deepEqual(diffToServerPatch({ caveman: 'off' }, server), { cavemanEnabled: false });
});

test('diffToServerPatch normalizes invalid/legacy local values', () => {
  const server = fromServer({ cavemanEnabled: true, cavemanLevel: 'lite' });
  assert.deepEqual(diffToServerPatch({ caveman: 'nope' }, server), { cavemanLevel: 'full' });
  assert.deepEqual(diffToServerPatch({ caveman: false }, server), { cavemanEnabled: false });
});

test('changedSettings lists differing setting names', () => {
  const server = fromServer({ pxpipeEnabled: true });
  const local = { ...fromServer({}) };
  assert.deepEqual(changedSettings(local, server), ['pxpipe']);
});
