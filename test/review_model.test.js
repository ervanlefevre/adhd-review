import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRulesText, defaultRules, DEFAULT_RULES_TEXT, OTHER_GROUP_LABEL } from "../src/rules.js";
import { orderFiles, groupFiles, progress, neighbourFile, nextPendingFile, positionInGroup } from "../src/review_model.js";

const file = (path, additions = 10, deletions = 0, viewerViewedState = "UNVIEWED") => ({ path, additions, deletions, viewerViewedState });

test("parseRulesText reads label, regex and optional weight, and reports bad lines", () => {
  const { rules, errors } = parseRulesText("Models | ^app/models/\nLocales | ^config/locales/(fr|en-gb)/ | 0.1\n\n# comment\nbroken line\nBad | (unclosed");
  assert.equal(rules.length, 2);
  assert.ok(rules[1].pattern.test("config/locales/en-gb/x.yml"));
  assert.ok(!rules[1].pattern.test("config/locales/de-de/x.yml"));
  assert.equal(rules[1].weight, 0.1);
  assert.equal(errors.length, 2);
});

test("the default rules parse without error", () => {
  const { rules, errors } = parseRulesText(DEFAULT_RULES_TEXT);
  assert.deepEqual(errors, []);
  assert.equal(rules.length, 11);
  assert.equal(rules.find((rule) => rule.label === "Locales (auto-translated)").weight, 0.1);
});

test("orderFiles follows the rule order, then the path, and sends unmatched files to Other", () => {
  const ordered = orderFiles(
    [file("spec/models/a_spec.rb"), file("app/models/b.rb"), file("app/models/a.rb"), file("lib/task.rake"), file("db/migrate/1.rb")],
    defaultRules()
  );
  assert.deepEqual(
    ordered.map((f) => f.path),
    ["db/migrate/1.rb", "app/models/a.rb", "app/models/b.rb", "spec/models/a_spec.rb", "lib/task.rake"]
  );
  assert.equal(ordered.at(-1).group, OTHER_GROUP_LABEL);
});

test("progress weights by capped lines and group weight", () => {
  const ordered = orderFiles(
    [
      file("app/models/a.rb", 50, 0, "VIEWED"), // weight 50
      file("app/models/big.rb", 2000, 0), // capped to 150
      file("config/locales/de-de/x.de-de.yml", 100, 0), // 100 * 0.1 = 10
    ],
    defaultRules()
  );
  const result = progress(ordered);
  assert.equal(result.percent, Math.round((50 / 210) * 100));
  assert.equal(result.viewedFiles, 1);
  assert.equal(result.totalFiles, 3);
  assert.equal(result.remainingLines, 2100);
});

test("groupFiles keeps review order and computes per-group counts", () => {
  const ordered = orderFiles([file("app/models/a.rb", 10, 0, "VIEWED"), file("app/models/b.rb"), file("spec/a_spec.rb")], defaultRules());
  const groups = groupFiles(ordered);
  assert.deepEqual(groups.map((g) => [g.label, g.viewedFiles, g.totalFiles]), [["Models", 1, 2], ["Specs", 0, 1]]);
  assert.deepEqual(positionInGroup(groups, "app/models/b.rb"), { group: groups[0], index: 2, total: 2 });
});

test("neighbourFile wraps around and nextPendingFile skips viewed and later files", () => {
  const ordered = orderFiles([file("a.rb", 1, 0, "VIEWED"), file("b.rb"), file("c.rb")], []);
  assert.equal(neighbourFile(ordered, "c.rb", 1).path, "a.rb");
  assert.equal(neighbourFile(ordered, "a.rb", -1).path, "c.rb");
  assert.equal(neighbourFile(ordered, "unknown", 1).path, "a.rb");
  assert.equal(nextPendingFile(ordered, "c.rb", new Set(["b.rb"])).path, "c.rb");
  assert.equal(nextPendingFile(ordered, "a.rb", new Set(["b.rb", "c.rb"])), null);
});
