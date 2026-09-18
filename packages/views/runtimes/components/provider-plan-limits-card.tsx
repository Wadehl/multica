"use client";

import { Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { providerDisplayName } from "@multica/core/runtimes";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import type { PlanLimitWindow } from "@multica/core/types";
import { ProviderLogo } from "./provider-logo";
import { PlanLimitWindowRow, providerPlanLimits } from "./plan-limits";
import { useNowTick } from "./shared";
import { useT, useTimeAgo } from "../../i18n";

/**
 * Quota left on each supported provider, one block per provider. The
 * analytics page answers "what did this cost"; this card answers the question
 * that follows it — "how much is left to spend" — from the snapshot the daemon
 * reported on its heartbeat.
 *
 * Nothing renders when the workspace has no runtime for a supported provider:
 * an empty card would report a quota problem where there is only an unused
 * provider.
 */
export function ProviderPlanLimitsCard() {
  const { t } = useT("runtimes");
  const wsId = useWorkspaceId();
  const now = useNowTick(60_000);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const providers = providerPlanLimits(runtimes, now);
  if (providers.length === 0) return null;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-body font-semibold">
          {t(($) => $.plan_limits.title)}
        </h3>
      </div>
      <div className="divide-y">
        {providers.map((provider) => (
          <ProviderPlanLimitsBlock
            key={provider.provider}
            provider={provider.provider}
            observedAt={provider.snapshot?.observed_at ?? null}
            windows={provider.windows}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderPlanLimitsBlock({
  provider,
  observedAt,
  windows,
}: {
  provider: string;
  observedAt: number | null;
  windows: PlanLimitWindow[];
}) {
  const { t } = useT("runtimes");
  const timeAgo = useTimeAgo();

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="flex items-center gap-2">
          <ProviderLogo provider={provider} className="h-3.5 w-3.5" />
          <span className="text-caption font-medium">
            {providerDisplayName(provider)}
          </span>
        </div>
        {observedAt ? (
          <span className="text-caption text-muted-foreground">
            {t(($) => $.plan_limits.observed, {
              when: timeAgo(new Date(observedAt * 1000).toISOString()),
            })}
          </span>
        ) : null}
      </div>
      {windows.length > 0 ? (
        <div className="divide-y">
          {windows.map((window) => (
            <PlanLimitWindowRow key={window.name} window={window} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-caption text-muted-foreground">
          {t(($) => $.plan_limits.unavailable)}
        </p>
      )}
    </div>
  );
}
