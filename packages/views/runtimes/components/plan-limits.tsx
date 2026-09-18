"use client";

import { Gauge } from "lucide-react";
import type {
  AgentRuntime,
  PlanLimitWindow,
  PlanLimitsSnapshot,
} from "@multica/core/types";
import { useT, useTimeAgo, useTimeUntil, useDateTime } from "../../i18n";

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DisplayPlanLimits {
  snapshot: PlanLimitsSnapshot;
  windows: PlanLimitWindow[];
}

/**
 * Drops windows after their reset boundary and expires observations after a
 * day. This prevents the UI from presenting an old exhausted state or usage
 * percentage as current when a daemon has stopped reporting.
 */
export function displayPlanLimits(
  snapshot: PlanLimitsSnapshot | null | undefined,
  nowMs = Date.now(),
): DisplayPlanLimits | null {
  if (!snapshot || snapshot.observed_at <= 0) return null;

  const nowSeconds = Math.floor(nowMs / 1000);
  const reportedWindows = snapshot.windows ?? [];
  const windows = reportedWindows.filter(
    (window) => window.resets_at == null || window.resets_at > nowSeconds,
  );
  if (reportedWindows.length > 0 && windows.length === 0) return null;

  const observedAge = nowMs - snapshot.observed_at * 1000;
  if (observedAge > SNAPSHOT_MAX_AGE_MS) return null;
  if (snapshot.status === "available" && windows.length === 0) return null;

  return { snapshot, windows };
}

export function planLimitWindowShortLabel(window: PlanLimitWindow): string {
  if (window.window_minutes === 300) return "5h";
  if (window.window_minutes === 10_080) return "7d";
  if (window.window_minutes === 43_200) return "30d";
  return window.name;
}

/**
 * Quota left in a window. Providers report what a window consumed, and the
 * reader asks how much is left; the remainder is the mirror of the reported
 * percentage. A window at or past its limit has nothing left rather than a
 * negative remainder.
 */
export function remainingPercent(window: PlanLimitWindow): number | null {
  if (window.used_percent == null) return null;
  return Math.max(0, 100 - window.used_percent);
}

/**
 * Low quota is the alarming end of the scale, so these thresholds run opposite
 * to the consumed percentages the providers report.
 */
export function remainingTone(percent: number): string {
  if (percent <= 0) return "text-destructive";
  if (percent <= 20) return "text-warning";
  return "text-foreground";
}

export function remainingBarTone(percent: number): string {
  if (percent <= 0) return "bg-destructive";
  if (percent <= 20) return "bg-warning";
  return "bg-primary";
}

/**
 * Providers whose quota the app shell and the analytics page report. Kept in
 * one list so a provider can never appear in one surface and be missing from
 * the other; adding a provider here is the whole change.
 */
export const TRACKED_PLAN_LIMIT_PROVIDERS = ["codex", "grok"] as const;

export interface ProviderPlanLimits {
  provider: string;
  /** Runtimes of this provider in the workspace, reporting or not. */
  runtimeCount: number;
  /** Newest observation that is still current, or null when none is. */
  snapshot: PlanLimitsSnapshot | null;
  /** Windows of `snapshot`; empty when the snapshot is null. */
  windows: PlanLimitWindow[];
}

/**
 * Folds a workspace's runtimes into one quota entry per tracked provider.
 *
 * Quota belongs to the account behind a CLI, not to a single machine, so
 * several runtimes of the same provider collapse into the newest observation
 * they reported between them. Runtimes that reported nothing still produce an
 * entry: "this provider is present but has no quota data" is a state the
 * reader needs, and dropping the provider would read as "not installed".
 */
export function providerPlanLimits(
  runtimes: readonly AgentRuntime[],
  nowMs = Date.now(),
): ProviderPlanLimits[] {
  const entries = TRACKED_PLAN_LIMIT_PROVIDERS.map((provider) => ({
    provider,
    runtimeCount: 0,
    snapshot: null as PlanLimitsSnapshot | null,
    windows: [] as PlanLimitWindow[],
  }));

  for (const runtime of runtimes) {
    const provider = runtime.provider?.trim().toLowerCase();
    const entry = entries.find((candidate) => candidate.provider === provider);
    if (!entry) continue;
    entry.runtimeCount += 1;

    const display = displayPlanLimits(runtime.plan_limits, nowMs);
    if (!display) continue;
    if (entry.snapshot && entry.snapshot.observed_at >= display.snapshot.observed_at) {
      continue;
    }
    entry.snapshot = display.snapshot;
    entry.windows = display.windows;
  }

  return entries.filter((entry) => entry.runtimeCount > 0);
}

export interface RemainingWindow {
  window: PlanLimitWindow;
  percent: number;
}

/** Windows carrying a usable percentage, the only ones worth drawing. */
export function remainingWindows(
  windows: readonly PlanLimitWindow[],
): RemainingWindow[] {
  return windows.flatMap((window) => {
    const percent = remainingPercent(window);
    return percent == null ? [] : [{ window, percent }];
  });
}

export function PlanLimitsCell({
  runtime,
  now = Date.now(),
}: {
  runtime: AgentRuntime;
  now?: number;
}) {
  const { t } = useT("runtimes");
  const display = displayPlanLimits(runtime.plan_limits, now);
  if (!display) {
    return <span className="text-caption text-faint-foreground">—</span>;
  }

  const remaining = remainingWindows(display.windows);
  if (remaining.length === 0) {
    return (
      <span className="truncate text-caption font-medium text-destructive">
        {t(($) => $.plan_limits.limit_reached)}
      </span>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-col leading-tight"
      aria-label={t(($) => $.plan_limits.title)}
    >
      {remaining.slice(0, 2).map(({ window, percent }) => (
        <span
          key={window.name}
          className={`truncate text-caption tabular-nums ${remainingTone(percent)}`}
        >
          <span className="text-muted-foreground">
            {planLimitWindowShortLabel(window)}
          </span>{" "}
          {t(($) => $.plan_limits.remaining, { percent: Math.round(percent) })}
        </span>
      ))}
    </div>
  );
}

export function planLimitWindowLabel(
  window: PlanLimitWindow,
  t: ReturnType<typeof useT<"runtimes">>["t"],
): string {
  if (window.window_minutes === 300) {
    return t(($) => $.plan_limits.window_5h);
  }
  if (window.window_minutes === 10_080) {
    return t(($) => $.plan_limits.window_7d);
  }
  if (window.window_minutes === 43_200) {
    return t(($) => $.plan_limits.window_30d);
  }
  if (window.name === "primary") {
    return t(($) => $.plan_limits.window_primary);
  }
  if (window.name === "secondary") {
    return t(($) => $.plan_limits.window_secondary);
  }
  return window.name;
}

/** One quota window: label, quota left, bar, and the reset it counts down to. */
export function PlanLimitWindowRow({ window }: { window: PlanLimitWindow }) {
  const { t } = useT("runtimes");
  const timeUntil = useTimeUntil();
  const dateTime = useDateTime();
  const percent = remainingPercent(window);
  const resetsAt = window.resets_at
    ? new Date(window.resets_at * 1000).toISOString()
    : null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption font-medium">
          {planLimitWindowLabel(window, t)}
        </span>
        {percent != null ? (
          <span
            className={`text-caption font-semibold tabular-nums ${remainingTone(percent)}`}
          >
            {t(($) => $.plan_limits.remaining, { percent: Math.round(percent) })}
          </span>
        ) : (
          <span className="text-caption font-medium text-destructive">
            {t(($) => $.plan_limits.limit_reached)}
          </span>
        )}
      </div>
      {percent != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${remainingBarTone(percent)}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {resetsAt && (
        <p className="mt-1.5 text-caption text-muted-foreground">
          {t(($) => $.plan_limits.resets_at, { when: dateTime(resetsAt) })}
          {" · "}
          {timeUntil(resetsAt)}
        </p>
      )}
    </div>
  );
}

export function PlanLimitsCard({
  runtime,
  now = Date.now(),
}: {
  runtime: AgentRuntime;
  now?: number;
}) {
  const { t } = useT("runtimes");
  const timeAgo = useTimeAgo();
  const display = displayPlanLimits(runtime.plan_limits, now);
  const observed = display
    ? timeAgo(new Date(display.snapshot.observed_at * 1000).toISOString())
    : null;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-body font-semibold">
            {t(($) => $.plan_limits.title)}
          </h3>
        </div>
        {observed && (
          <span className="text-caption text-muted-foreground">
            {t(($) => $.plan_limits.observed, { when: observed })}
          </span>
        )}
      </div>

      {!display ? (
        <div className="px-4 py-5">
          <p className="text-body font-medium">
            {t(($) => $.plan_limits.unavailable)}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {runtime.provider === "claude"
              ? t(($) => $.plan_limits.unavailable_hint_claude)
              : t(($) => $.plan_limits.unavailable_hint)}
          </p>
        </div>
      ) : display.windows.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-body font-medium text-destructive">
            {t(($) => $.plan_limits.limit_reached)}
          </p>
        </div>
      ) : (
        <div className="divide-y">
          {display.windows.map((window) => (
            <PlanLimitWindowRow key={window.name} window={window} />
          ))}
        </div>
      )}
    </section>
  );
}
