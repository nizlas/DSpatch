/**
 * DSP-165.1: a start that names its isolated profile goes no further on another one. What the main
 * process decides from the expected profile, the one Electron chose and the arguments it was given.
 * Launching a window on the wrong profile is in DSP-165.1's notes, with disposable folders only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { profileRefusal } from '../src/main/profile-guard.ts';

describe('the isolated-profile guard', () => {
  const special = 'C:\\Temp\\dsp guard 100% a&b ^!(x) åäö\\profile';

  it('checks nothing when no profile is expected', () => {
    assert.equal(profileRefusal(undefined, 'C:\\anything', []), null);
    assert.equal(profileRefusal('  ', 'C:\\anything', []), null);
  });

  it('accepts the expected profile, special characters and Windows case included', () => {
    assert.equal(profileRefusal(special, special.toUpperCase(), [`--user-data-dir=${special}`], 'win32'), null);
    assert.equal(profileRefusal('/tmp/a b/profile', '/tmp/a b/profile', ['--user-data-dir=/tmp/a b/profile'], 'linux'), null);
  });

  it('refuses another profile', () => {
    assert.match(profileRefusal(special, 'C:\\Temp\\other', [`--user-data-dir=C:\\Temp\\other`], 'win32') ?? '', /but Electron chose C:\\Temp\\other/);
    assert.match(profileRefusal('/tmp/A', '/tmp/a', ['--user-data-dir=/tmp/a'], 'linux') ?? '', /but Electron chose/);
  });

  it('refuses a start that did not name the profile to Electron', () => {
    assert.match(profileRefusal(special, special, [], 'win32') ?? '', /was not given --user-data-dir/);
  });
});
