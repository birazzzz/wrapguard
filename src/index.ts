export { defineConfig, loadConfig, resolveConfig, DEFAULT_SELECTOR, type WrapguardConfig, type ResolvedConfig } from "./config.ts";
export { scan, type ScanProgress } from "./scan.ts";
export { diffSnapshots, hasFailures, type DiffResult, type ElementChange, type WidthChange } from "./diff.ts";
export { readSnapshot, writeSnapshot, serializeSnapshot, type Snapshot, type SnapshotElement } from "./snapshot.ts";
export { measureInPage, type MeasureOptions, type MeasuredElement } from "./measure.ts";
