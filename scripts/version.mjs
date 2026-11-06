#!/usr/bin/env node
// The version numbers of Gittor. A release has a plain version, for example 0.2.0. A test build has a
// pre-release label, for example 0.2.1-dev.5+a1b2c3d4: 5 commits after the last release, at commit
// a1b2c3d4. Semver puts a test build before the release that follows it, so the updater never takes a
// test build for a newer version.
//
// Usage (from the root of the repository):
//   node scripts/version.mjs current                  the version in tauri.conf.json
//   node scripts/version.mjs next [patch|minor|major|<x.y.z>]
//                                                     the version of the next release (default: patch)
//   node scripts/version.mjs build                    the version of a build of the working tree
//   node scripts/version.mjs build-number             a number that grows with each commit (CFBundleVersion)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

/** The parts of a plain version x.y.z. */
export function parse(v) {
  const m = PLAIN.exec(v);
  if (!m) throw new Error(`${v} is not a version x.y.z`);
  return m.slice(1).map(Number);
}

/** -1, 0 or 1: the order of two plain versions. */
export function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  const d = x.map((n, i) => n - y[i]).find((n) => n !== 0) ?? 0;
  return Math.sign(d);
}

/** The version after `v`: one part goes up, and the parts after it go to 0. */
export function bump(v, part) {
  const [major, minor, patch] = parse(v);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  if (part === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Use patch, minor, major or a version x.y.z, not ${part}`);
}

/**
 * The version of the next release. `released` tells if a release of `current` exists (its tag). A
 * version that has no release yet is the next release for "patch".
 */
export function nextRelease(current, released, what = "patch") {
  if (PLAIN.test(what)) {
    if (compare(what, current) < 0 || (released && compare(what, current) === 0)) {
      throw new Error(`The version ${what} is not greater than the version ${current} of the last release`);
    }
    return what;
  }
  if (!released && what === "patch") return current;
  return bump(current, what);
}

/**
 * The version of a build. At a release tag with no changes, the release version. Otherwise the next
 * release with the label dev.<commits since the last release>, and the commit as build metadata.
 */
export function buildVersion({ current, released, commits, sha, dirty }) {
  if (released && commits === 0 && !dirty) return current;
  const next = nextRelease(current, released);
  return `${next}-dev.${commits}+${sha}${dirty ? ".dirty" : ""}`;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

/** The facts of the repository that the versions need. */
export function repoState() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  process.chdir(root);
  const current = JSON.parse(readFileSync("crates/app/tauri.conf.json", "utf8")).version;
  const tag = `v${current}`;
  const released = tryGit("rev-parse", "-q", "--verify", `refs/tags/${tag}`) !== null;
  const commits = Number(released ? git("rev-list", "--count", `${tag}..HEAD`) : git("rev-list", "--count", "HEAD"));
  const sha = git("rev-parse", "--short=8", "HEAD");
  const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
  return { current, released, commits, sha, dirty };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [what, arg] = process.argv.slice(2);
  try {
    const s = repoState();
    if (what === "current") console.log(s.current);
    else if (what === "next") console.log(nextRelease(s.current, s.released, arg ?? "patch"));
    else if (what === "build") console.log(buildVersion(s));
    else if (what === "build-number") console.log(git("rev-list", "--count", "HEAD"));
    else throw new Error("Usage: node scripts/version.mjs current | next [patch|minor|major|x.y.z] | build | build-number");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
