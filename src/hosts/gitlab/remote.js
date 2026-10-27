// Pure mapping of GitLab's page data to the extension's remote state, the shape the
// model and the panels already consume for GitHub:
//   { id, title, url, viewer, files: [{ path, additions, deletions, changeType,
//     viewerViewedState, fileHash, codeReviewId }], pendingReview, codeReviewEnabled }
//
// `diffFiles` is GitLab's diff_files_metadata payload; `viewedIds` the code_review_ids
// GitLab autosaved in localStorage (one id per file content, so a file that changed
// since it was viewed is pending again, exactly GitLab's own rule).

export function remoteFromMetadata({ diffFiles, viewedIds, projectPath, iid, title, url, codeReviewEnabled = true }) {
  const viewed = new Set(viewedIds || []);
  const files = (diffFiles || []).map((file) => ({
    path: file.new_path || file.old_path,
    oldPath: file.old_path,
    additions: file.added_lines || 0,
    deletions: file.removed_lines || 0,
    changeType: changeTypeOf(file),
    viewerViewedState: viewed.has(file.code_review_id) ? "VIEWED" : "UNVIEWED",
    fileHash: file.file_hash,
    codeReviewId: file.code_review_id,
  }));
  return {
    id: `${projectPath}!${iid}`,
    iid,
    projectPath,
    title,
    url,
    viewer: null,
    files,
    pendingReview: null,
    codeReviewEnabled,
  };
}

function changeTypeOf(file) {
  if (file.new_file) return "ADDED";
  if (file.deleted_file) return "DELETED";
  if (file.old_path && file.new_path && file.old_path !== file.new_path) return "RENAMED";
  return "MODIFIED";
}

// GitLab's localStorage key for the viewed files of a merge request ("mr_path" is
// "/group/project/-/merge_requests/12").
export function viewedStorageKey(mrPath) {
  return `code-review-${mrPath}`;
}
