import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSettings, diffToServerPatch, fromServer } from '../tokenSaverMapping';

test('fromServer applies defaults and rejects invalid enums', () => {
  const v = fromServer({ rtkEnabled: false, cavemanLevel: 'bogus', ponytailLevel: 'ultra' });
  assert.equal(v.rtk, false);
  assert.equal(v.caveman, false);
  assert.equal(v.cavemanLevel, 'full');
  assert.equal(v.ponytailLevel, 'ultra');
  assert.equal(v.headroomUrl, 'http://localhost:8787');
});

test('diffToServerPatch only includes changed fields', () => {
  const server = fromServer({});
  assert.equal(diffToServerPatch({ ...server }, server), undefined);
  assert.deepEqual(diffToServerPatch({ ...server, rtk: false, cavemanLevel: 'ultra' }, server), {
    rtkEnabled: false,
    cavemanLevel: 'ultra',
  });
});

test('diffToServerPatch normalizes invalid local enum to default', () => {
  const server = fromServer({ cavemanLevel: 'lite' });
  assert.deepEqual(diffToServerPatch({ cavemanLevel: 'nope' }, server), { cavemanLevel: 'full' });
});

test('changedSettings lists differing setting names', () => {
  const server = fromServer({ pxpipeEnabled: true });
  const local = { ...fromServer({}) };
  assert.deepEqual(changedSettings(local, server), ['pxpipe']);
});
