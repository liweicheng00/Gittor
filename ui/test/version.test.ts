// The version numbers of releases and test builds (scripts/version.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: a plain JavaScript module of the scripts folder.
import { buildVersion, bump, nextRelease } from "../../scripts/version.mjs";

test("bump", () => {
  assert.equal(bump("0.1.9", "patch"), "0.1.10");
  assert.equal(bump("0.1.9", "minor"), "0.2.0");
  assert.equal(bump("0.1.9", "major"), "1.0.0");
  assert.throws(() => bump("0.1", "patch"));
});

test("the next release", () => {
  // A version without a release is the next patch release.
  assert.equal(nextRelease("0.1.0", false), "0.1.0");
  assert.equal(nextRelease("0.1.0", false, "minor"), "0.2.0");
  assert.equal(nextRelease("0.1.0", true), "0.1.1");
  assert.equal(nextRelease("0.1.0", true, "1.0.0"), "1.0.0");
  assert.throws(() => nextRelease("0.1.0", true, "0.1.0"));
  assert.throws(() => nextRelease("0.2.0", true, "0.1.5"));
  assert.throws(() => nextRelease("0.1.0", true, "huge"));
});

test("the version of a build", () => {
  const at = { current: "0.2.0", released: true, commits: 0, sha: "a1b2c3d4", dirty: false };
  // At the release tag: the release version.
  assert.equal(buildVersion(at), "0.2.0");
  // After the release: the next patch, with the dev label.
  assert.equal(buildVersion({ ...at, commits: 5 }), "0.2.1-dev.5+a1b2c3d4");
  // Changes that are not committed.
  assert.equal(buildVersion({ ...at, dirty: true }), "0.2.1-dev.0+a1b2c3d4.dirty");
  // No release of the version yet: the build comes before it.
  assert.equal(buildVersion({ ...at, released: false, commits: 120 }), "0.2.0-dev.120+a1b2c3d4");
});
