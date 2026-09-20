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
  planLimitWindowLabel,
  planLimitWindowShortLabel,
  providerPlanLimits,
  remainingPercent,
  remainingTone,
  type ProviderPlanLimits,
} from "../runtimes/components/plan-limits";
import { useNowTick } from "../runtimes/components/shared";
import { useT, useDateTime, useTimeUntil } from "../i18n";

/**
 * Application status bar. Sits under the sidebar and the workspace content and
 * reports the quota each supported provider CLI has left, read from the
 * daemon-reported snapshots the runtime list already carries.
 *
 * Each window shows the quota remaining and the wall-clock moment it refreshes,
 * because a percentage alone does not say whether the limit comes back before
 * the next working session.
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
      className="flex h-10 shrink-0 items-center gap-4 overflow-x-auto border-t bg-app-shell ps-3 pe-chat-launcher"
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
  const dateTime = useDateTime();
  const name = providerDisplayName(provider.provider);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex shrink-0 items-center gap-2.5 text-caption">
            <div className="flex shrink-0 items-center gap-1.5">
              <ProviderLogo
                provider={provider.provider}
                className="h-3.5 w-3.5"
              />
              <span className="font-medium">{name}</span>
            </div>
            {!provider.snapshot ? (
              <span className="text-muted-foreground">
                {t(($) => $.plan_limits.no_data)}
              </span>
            ) : provider.windows.length === 0 ? (
              <span className="font-medium text-destructive">
                {t(($) => $.plan_limits.limit_reached)}
              </span>
            ) : (
              provider.windows.map((window) => {
                const percent = remainingPercent(window);
                const resetsAt = window.resets_at
                  ? new Date(window.resets_at * 1000).toISOString()
                  : null;
                return (
                  <span
                    key={window.name}
                    className="flex shrink-0 flex-col leading-tight"
                  >
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">
                        {planLimitWindowShortLabel(window)}
                      </span>
                      {percent != null ? (
                        <span className={`tabular-nums ${remainingTone(percent)}`}>
                          {t(($) => $.plan_limits.remaining, {
                            percent: Math.round(percent),
                          })}
                        </span>
                      ) : (
                        <span className="font-medium text-destructive">
                          {t(($) => $.plan_limits.limit_reached)}
                        </span>
                      )}
                    </span>
                    {resetsAt ? (
                      <span className="whitespace-nowrap text-muted-foreground">
                        {t(($) => $.plan_limits.resets_at, {
                          when: dateTime(resetsAt),
                        })}
                      </span>
                    ) : null}
                  </span>
                );
              })
            )}
          </div>
        }
      />
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{name}</span>
          {provider.snapshot ? (
            provider.windows.length > 0 ? (
              provider.windows.map((window) => {
                const percent = remainingPercent(window);
                const resetsAt = window.resets_at
                  ? new Date(window.resets_at * 1000).toISOString()
                  : null;
                return (
                  <span key={window.name}>
                    {planLimitWindowLabel(window, t)} ·{" "}
                    {percent != null
                      ? t(($) => $.plan_limits.remaining, {
                          percent: Math.round(percent),
                        })
                      : t(($) => $.plan_limits.limit_reached)}
                    {resetsAt
                      ? ` · ${t(($) => $.plan_limits.resets_at, {
                          when: dateTime(resetsAt),
                        })} · ${timeUntil(resetsAt)}`
                      : null}
                  </span>
                );
              })
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
