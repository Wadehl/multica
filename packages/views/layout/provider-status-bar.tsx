"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { providerDisplayName } from "@multica/core/runtimes";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { ProviderLogo } from "../runtimes/components/provider-logo";
import {
  percentageTone,
  percentageWindows,
  planLimitWindowLabel,
  planLimitWindowShortLabel,
  providerPlanLimits,
  type ProviderPlanLimits,
} from "../runtimes/components/plan-limits";
import { useNowTick } from "../runtimes/components/shared";
import { useT, useTimeUntil } from "../i18n";

/**
 * Application status bar. Sits under the sidebar and the workspace content and
 * reports the quota each supported provider CLI has left, read from the
 * daemon-reported snapshots the runtime list already carries.
 *
 * A provider the workspace has no runtime for is not an entry — the bar
 * answers "what can this workspace run right now", and listing absent
 * providers would turn a glanceable strip into a catalogue.
 */
export function ProviderStatusBar() {
  const wsId = useWorkspaceId();
  const now = useNowTick(60_000);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  return (
    <ProviderStatusBarView providers={providerPlanLimits(runtimes, now)} />
  );
}

export function ProviderStatusBarView({
  providers,
}: {
  providers: ProviderPlanLimits[];
}) {
  const { t } = useT("runtimes");
  if (providers.length === 0) return null;

  return (
    <footer
      aria-label={t(($) => $.plan_limits.status_bar_label)}
      className="flex h-8 shrink-0 items-center gap-4 overflow-x-auto border-t bg-app-shell ps-3 pe-chat-launcher"
    >
      {providers.map((provider) => (
        <ProviderStatusEntry key={provider.provider} provider={provider} />
      ))}
    </footer>
  );
}

function ProviderStatusEntry({ provider }: { provider: ProviderPlanLimits }) {
  const { t } = useT("runtimes");
  const timeUntil = useTimeUntil();
  const name = providerDisplayName(provider.provider);
  const percentages = percentageWindows(provider.windows);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex shrink-0 items-center gap-1.5 text-caption">
            <ProviderLogo
              provider={provider.provider}
              className="h-3.5 w-3.5"
            />
            <span className="font-medium">{name}</span>
            {!provider.snapshot ? (
              <span className="text-muted-foreground">
                {t(($) => $.plan_limits.no_data)}
              </span>
            ) : percentages.length === 0 ? (
              <span className="font-medium text-destructive">
                {t(($) => $.plan_limits.limit_reached)}
              </span>
            ) : (
              percentages.map((window) => (
                <span key={window.name} className="flex items-center gap-1">
                  <span className="text-muted-foreground">
                    {planLimitWindowShortLabel(window)}
                  </span>
                  <span
                    className={`tabular-nums ${percentageTone(window.used_percent)}`}
                  >
                    {Math.round(window.used_percent)}%
                  </span>
                </span>
              ))
            )}
          </div>
        }
      />
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{name}</span>
          {provider.snapshot ? (
            provider.windows.length > 0 ? (
              provider.windows.map((window) => (
                <span key={window.name}>
                  {planLimitWindowLabel(window, t)} ·{" "}
                  {window.used_percent != null
                    ? t(($) => $.plan_limits.used, {
                        percent: Math.round(window.used_percent as number),
                      })
                    : t(($) => $.plan_limits.limit_reached)}
                  {window.resets_at
                    ? ` · ${t(($) => $.plan_limits.resets, {
                        when: timeUntil(
                          new Date(window.resets_at * 1000).toISOString(),
                        ),
                      })}`
                    : null}
                </span>
              ))
            ) : (
              <span>{t(($) => $.plan_limits.limit_reached)}</span>
            )
          ) : (
            <span>{t(($) => $.plan_limits.no_data)}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
