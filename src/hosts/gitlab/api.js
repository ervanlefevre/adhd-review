// GitLab REST API (gitlab.com), used only for the wrap-up: the caller's draft notes,
// publishing them with a summary, approving, or a plain note. The file list and the
// viewed state come from the page (see page_data.js).
import { mergeRequestUrl } from "./url.js";

const API_URL = "https://gitlab.com/api/v4";

export class GitLabApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

export class GitLabApi {
  constructor(token) {
    if (!token) throw new GitLabApiError("No GitLab token configured. Open the extension options to add one (scope: api).");
    this.token = token;
  }

  async request(method, path, body) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "PRIVATE-TOKEN": this.token,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await this.describeHttpError(response);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async describeHttpError(response) {
    const text = await response.text().catch(() => "");
    if (response.status === 401) return new GitLabApiError("GitLab rejected the token (401). Check it in the options.", { status: 401 });
    if (response.status === 403) return new GitLabApiError("GitLab refused the request (403): the token needs the api scope and access to the project.", { status: 403 });
    if (response.status === 404) return new GitLabApiError("GitLab answered 404: the merge request was not found, or the token cannot see the project.", { status: 404 });
    return new GitLabApiError(`GitLab API error ${response.status}: ${text.slice(0, 200)}`, { status: response.status });
  }

  async currentUser() {
    const user = await this.request("GET", "/user");
    return user.username;
  }

  // Only the caller's own drafts are returned by GitLab; mapped to the comment shape
  // the wrap-up tab shows for GitHub.
  async draftNotes({ projectPath, iid }) {
    const drafts = await this.request("GET", `${mergeRequestPath(projectPath, iid)}/draft_notes`);
    return (drafts || []).map((draft) => {
      const position = draft.position || {};
      return {
        databaseId: draft.id,
        path: position.new_path || position.old_path || null,
        line: position.new_line ?? position.old_line ?? null,
        position: { newLine: position.new_line ?? null, oldLine: position.old_line ?? null },
        body: draft.note,
        url: null,
        outdated: false,
      };
    });
  }

  // event: COMMENT | APPROVE | REQUEST_CHANGES, like GitHub's review events.
  // Drafts are published together with the summary note; without drafts the summary
  // becomes a plain note on the merge request.
  async submitReview({ projectPath, iid, event, body, hasDrafts }) {
    const base = mergeRequestPath(projectPath, iid);
    const url = mergeRequestUrl({ projectPath, iid });
    const note = body?.trim() || "";
    if (event === "APPROVE") {
      await this.request("POST", `${base}/approve`);
      await this.publish(base, { note, hasDrafts });
      return { url, state: "approved" };
    }
    if (event === "REQUEST_CHANGES") {
      if (hasDrafts) {
        await this.request("POST", `${base}/draft_notes/bulk_publish`, { note: note || undefined, reviewer_state: "requested_changes" });
      } else {
        await this.request("POST", `${base}/draft_notes/bulk_publish`, { note: note || undefined, reviewer_state: "requested_changes" }).catch(async () => {
          if (!note) throw new GitLabApiError("Nothing to publish: no draft note and no summary.");
          await this.request("POST", `${base}/notes`, { body: note });
        });
      }
      return { url, state: "changes_requested" };
    }
    if (!hasDrafts && !note) throw new GitLabApiError("Nothing to publish: no draft note and no summary.");
    await this.publish(base, { note, hasDrafts });
    return { url, state: "commented" };
  }

  async publish(base, { note, hasDrafts }) {
    if (hasDrafts) {
      await this.request("POST", `${base}/draft_notes/bulk_publish`, { note: note || undefined });
    } else if (note) {
      await this.request("POST", `${base}/notes`, { body: note });
    }
  }
}

function mergeRequestPath(projectPath, iid) {
  return `/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}`;
}
