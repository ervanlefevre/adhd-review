import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteFromMetadata, viewedStorageKey } from "../src/hosts/gitlab/remote.js";

// A diff_files_metadata payload as gitlab.com returns it.
const diffFiles = [
  { added_lines: 1, removed_lines: 1, new_path: "app/finders/projects/ml/model_finder.rb", old_path: "app/finders/projects/ml/model_finder.rb", new_file: false, deleted_file: false, file_hash: "0b6f8443", code_review_id: "8e95e416" },
  { added_lines: 4, removed_lines: 0, new_path: "db/schema_migrations/20261021161148", old_path: "db/schema_migrations/20261021161148", new_file: true, deleted_file: false, file_hash: "f6e3f386", code_review_id: "aaaa" },
  { added_lines: 0, removed_lines: 12, new_path: "old/gone.rb", old_path: "old/gone.rb", new_file: false, deleted_file: true, file_hash: "2a0ea66c", code_review_id: "bbbb" },
  { added_lines: 2, removed_lines: 2, new_path: "lib/new_name.rb", old_path: "lib/old_name.rb", new_file: false, deleted_file: false, file_hash: "91324421", code_review_id: "cccc" },
];

test("remoteFromMetadata maps GitLab's metadata to the shared remote shape and reads viewed ids", () => {
  const remote = remoteFromMetadata({ diffFiles, viewedIds: ["8e95e416", "stale-id"], projectPath: "d332/ld48", iid: 397, title: "Fix the jump", url: "https://gitlab.com/d332/ld48/-/merge_requests/397" });
  assert.equal(remote.id, "d332/ld48!397");
  assert.equal(remote.pendingReview, null);
  assert.deepEqual(
    remote.files.map((file) => [file.path, file.additions, file.deletions, file.changeType, file.viewerViewedState, file.fileHash]),
    [
      ["app/finders/projects/ml/model_finder.rb", 1, 1, "MODIFIED", "VIEWED", "0b6f8443"],
      ["db/schema_migrations/20261021161148", 4, 0, "ADDED", "UNVIEWED", "f6e3f386"],
      ["old/gone.rb", 0, 12, "DELETED", "UNVIEWED", "2a0ea66c"],
      ["lib/new_name.rb", 2, 2, "RENAMED", "UNVIEWED", "91324421"],
    ]
  );
  assert.equal(remote.files[3].oldPath, "lib/old_name.rb");
});

test("the viewed storage key follows GitLab's autosave convention", () => {
  assert.equal(viewedStorageKey("/d332/ld48/-/merge_requests/397"), "code-review-/d332/ld48/-/merge_requests/397");
});
