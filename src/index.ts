export {
  defineConfig,
  loadConfig,
  resolveConfig,
  DEFAULT_SELECTOR,
  type WrapguardConfig,
  type ResolvedConfig,
  type LineRule,
  type SitemapOptions,
  type ServerOptions,
} from "./config.ts";
export { pagesFromSitemap } from "./sitemap.ts";
export { startServer, isUp, type RunningServer } from "./server.ts";
export { withSite, resolvePages } from "./site.ts";
export { scan, type ScanProgress, type ScanResult } from "./scan.ts";
export {
  diffSnapshots,
  hasFailures,
  type DiffResult,
  type ElementChange,
  type WidthChange,
  type LimitViolation,
} from "./diff.ts";
export { readSnapshot, writeSnapshot, serializeSnapshot, type Snapshot, type SnapshotElement } from "./snapshot.ts";
export { measureInPage, type MeasureOptions, type MeasuredElement } from "./measure.ts";
export { formatMarkdown, formatReport, formatLimits, COMMENT_MARKER, type ReportOptions } from "./report.ts";
export { upsertComment, GitHubError, type GitHubTarget, type CommentResult } from "./github.ts";
