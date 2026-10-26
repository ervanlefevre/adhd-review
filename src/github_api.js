const GRAPHQL_URL = "https://api.github.com/graphql";

export class GitHubApiError extends Error {
  constructor(message, { status, sso } = {}) {
    super(message);
    this.status = status;
    this.sso = sso;
  }
}

const PULL_REQUEST_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      title
      url
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions changeType viewerViewedState }
      }
      reviews(states: PENDING, first: 5) {
        nodes {
          id
          databaseId
          author { login }
          comments(first: 100) {
            nodes { databaseId path line originalLine body url outdated }
          }
        }
      }
    }
  }
}`;

const MARK_VIEWED_MUTATION = `
mutation($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
}`;

const UNMARK_VIEWED_MUTATION = `
mutation($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
}`;

const SUBMIT_REVIEW_MUTATION = `
mutation($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestReviewId: $reviewId, event: $event, body: $body }) {
    pullRequestReview { url state }
  }
}`;

const ADD_REVIEW_MUTATION = `
mutation($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, event: $event, body: $body }) {
    pullRequestReview { url state }
  }
}`;

export class GitHubApi {
  constructor(token) {
    if (!token) throw new GitHubApiError("No GitHub token configured. Open the extension options to add one.");
    this.token = token;
  }

  async graphql(query, variables = {}) {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw await this.describeHttpError(response);
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new GitHubApiError(payload.errors.map((error) => error.message).join("; "));
    }
    return payload.data;
  }

  async describeHttpError(response) {
    const sso = response.headers.get("x-github-sso");
    if (response.status === 401) return new GitHubApiError("GitHub rejected the token (401). Check it in the options.", { status: 401 });
    if (response.status === 403 && sso) {
      return new GitHubApiError("The token is not authorized for this organization's SSO. Authorize it on github.com (token settings → Configure SSO).", { status: 403, sso });
    }
    const text = await response.text().catch(() => "");
    return new GitHubApiError(`GitHub API error ${response.status}: ${text.slice(0, 200)}`, { status: response.status });
  }

  async viewerLogin() {
    const data = await this.graphql("query { viewer { login } }");
    return data.viewer.login;
  }

  async pullRequest({ owner, repo, number }) {
    let after = null;
    let files = [];
    let pullRequest = null;
    let viewer = null;
    do {
      const data = await this.graphql(PULL_REQUEST_QUERY, { owner, repo, number, after });
      viewer = data.viewer.login;
      pullRequest = data.repository?.pullRequest;
      if (!pullRequest) throw new GitHubApiError(`Pull request ${owner}/${repo}#${number} not found or not accessible with this token.`);
      files = files.concat(pullRequest.files.nodes);
      after = pullRequest.files.pageInfo.hasNextPage ? pullRequest.files.pageInfo.endCursor : null;
    } while (after);

    const pendingReview = pullRequest.reviews.nodes.find((review) => review.author?.login === viewer) || null;
    return {
      id: pullRequest.id,
      title: pullRequest.title,
      url: pullRequest.url,
      viewer,
      files,
      pendingReview: pendingReview
        ? {
            id: pendingReview.id,
            databaseId: pendingReview.databaseId,
            comments: pendingReview.comments.nodes.map((comment) => ({
              databaseId: comment.databaseId,
              path: comment.path,
              line: comment.line ?? comment.originalLine ?? null,
              body: comment.body,
              url: comment.url,
              outdated: comment.outdated,
            })),
          }
        : null,
    };
  }

  async setFileViewed(pullRequestId, path, viewed) {
    await this.graphql(viewed ? MARK_VIEWED_MUTATION : UNMARK_VIEWED_MUTATION, { pullRequestId, path });
  }

  async submitReview({ reviewId, pullRequestId, event, body }) {
    if (reviewId) {
      const data = await this.graphql(SUBMIT_REVIEW_MUTATION, { reviewId, event, body });
      return data.submitPullRequestReview.pullRequestReview;
    }
    const data = await this.graphql(ADD_REVIEW_MUTATION, { pullRequestId, event, body });
    return data.addPullRequestReview.pullRequestReview;
  }
}
