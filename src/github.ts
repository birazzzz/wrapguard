import { COMMENT_MARKER } from "./report.ts";

export interface GitHubTarget {
  /** e.g. `https://api.github.com` (`GITHUB_API_URL` on Actions, which also covers GitHub Enterprise). */
  apiUrl: string;
  /** `owner/name` */
  repository: string;
  token: string;
  /** Pull request number. Pull requests are issues as far as comments go. */
  issueNumber: number;
  fetch?: typeof fetch;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type CommentResult = "created" | "updated" | "unchanged" | "skipped";

interface IssueComment {
  id: number;
  body?: string;
}

/**
 * Keeps one wrapguard comment per pull request: updates it when it exists, and only
 * creates it when `create` is true, so a clean run on a quiet pull request posts nothing.
 */
export async function upsertComment(target: GitHubTarget, body: string, create: boolean): Promise<CommentResult> {
  const request = async <T>(method: string, path: string, payload?: unknown): Promise<T> => {
    const response = await (target.fetch ?? fetch)(`${target.apiUrl}/repos/${target.repository}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new GitHubError(response.status, `${method} ${path} answered ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  };

  let existing: IssueComment | undefined;
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = await request<IssueComment[]>("GET", `/issues/${target.issueNumber}/comments?per_page=100&page=${page}`);
    existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (comments.length < 100) break;
  }

  if (existing) {
    if (existing.body === body) return "unchanged";
    await request("PATCH", `/issues/comments/${existing.id}`, { body });
    return "updated";
  }
  if (!create) return "skipped";
  await request("POST", `/issues/${target.issueNumber}/comments`, { body });
  return "created";
}
