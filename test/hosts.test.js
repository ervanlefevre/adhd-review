import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewUrl, hostForKey, hosts } from "../src/hosts/index.js";

test("GitHub pull request URLs give an owner/repo#number key and the tab", () => {
  const info = parseReviewUrl("https://github.com/kacty/kactus/pull/10170/changes?diff=unified#diff-abc");
  assert.deepEqual(info, { host: "github", owner: "kacty", repo: "kactus", number: 10170, tab: "changes", prKey: "kacty/kactus#10170" });
  assert.ok(hosts.github.isFilesTab(info));
  assert.ok(!hosts.github.isFilesTab(parseReviewUrl("https://github.com/kacty/kactus/pull/10170")));
  assert.equal(hostForKey("kacty/kactus#10170"), hosts.github);
  assert.deepEqual(hosts.github.parseKey("kacty/kactus#10170"), { owner: "kacty", repo: "kactus", number: 10170 });
  assert.equal(hosts.github.numberLabel("kacty/kactus#10170"), "#10170");
});

test("GitLab merge request URLs keep nested project paths and only the diffs tab counts", () => {
  const info = parseReviewUrl("https://gitlab.com/d332/ld48/-/merge_requests/397/diffs#4ea7b735");
  assert.deepEqual(info, { host: "gitlab", projectPath: "d332/ld48", iid: 397, tab: "diffs", prKey: "gitlab:d332/ld48!397" });
  assert.ok(hosts.gitlab.isFilesTab(info));
  assert.ok(!hosts.gitlab.isFilesTab(parseReviewUrl("https://gitlab.com/d332/ld48/-/merge_requests/397")));
  assert.ok(!hosts.gitlab.isFilesTab(parseReviewUrl("https://gitlab.com/d332/ld48/-/merge_requests/397/commits")));
  const nested = parseReviewUrl("https://gitlab.com/group/sub/project/-/merge_requests/12/diffs?diff_id=1");
  assert.equal(nested.prKey, "gitlab:group/sub/project!12");
  assert.equal(hostForKey(nested.prKey), hosts.gitlab);
  assert.deepEqual(hosts.gitlab.parseKey(nested.prKey), { projectPath: "group/sub/project", iid: 12 });
  assert.equal(hosts.gitlab.numberLabel(nested.prKey), "!12");
  assert.equal(hosts.gitlab.mergeRequestUrl({ projectPath: "d332/ld48", iid: 397 }), "https://gitlab.com/d332/ld48/-/merge_requests/397");
});

test("other URLs are not review pages", () => {
  assert.equal(parseReviewUrl("https://gitlab.com/d332/ld48/-/issues/3"), null);
  assert.equal(parseReviewUrl("https://github.com/kacty/kactus/issues/3"), null);
  assert.equal(parseReviewUrl(""), null);
});
