// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import type { AgentRuntime, PlanLimitsSnapshot } from "@multica/core/types";
import enRuntimes from "../../locales/en/runtimes.json";
import {
  displayPlanLimits,
  PlanLimitsCell,
  planLimitWindowShortLabel,
  providerPlanLimits,
  remainingPercent,
  remainingWindows,
} from "./plan-limits";

const NOW = Date.UTC(2026, 7, 21, 12);

const SNAPSHOT: PlanLimitsSnapshot = {
  provider: "codex",
  status: "available",
  observed_at: NOW / 1000,
  windows: [
    {
      name: "primary",
      used_percent: 42,
      window_minutes: 300,
      resets_at: NOW / 1000 + 60,
    },
  ],
};

describe("displayPlanLimits", () => {
  it("drops a percentage after its provider reset boundary", () => {
    expect(displayPlanLimits(SNAPSHOT, NOW)).not.toBeNull();
    expect(displayPlanLimits(SNAPSHOT, NOW + 61_000)).toBeNull();
  });

  it("expires reset-less exhausted observations after one day", () => {
    const exhausted: PlanLimitsSnapshot = {
      provider: "claude",
      status: "exhausted",
      observed_at: NOW / 1000,
    };
    expect(displayPlanLimits(exhausted, NOW)).not.toBeNull();
    expect(displayPlanLimits(exhausted, NOW + 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it("expires stale percentages even when the provider reset is later", () => {
    const weekly: PlanLimitsSnapshot = {
      ...SNAPSHOT,
      windows: [{
        name: "secondary",
        used_percent: 18,
        window_minutes: 10_080,
        resets_at: NOW / 1000 + 7 * 24 * 60 * 60,
      }],
    };
    expect(displayPlanLimits(weekly, NOW + 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it("uses provider window durations for compact labels", () => {
    expect(planLimitWindowShortLabel(SNAPSHOT.windows![0]!)).toBe("5h");
  });

  it("labels the Grok monthly window by its duration", () => {
    expect(
      planLimitWindowShortLabel({ name: "monthly", window_minutes: 43_200 }),
    ).toBe("30d");
  });
});

describe("providerPlanLimits", () => {
  function runtime(
    provider: string,
    plan_limits: PlanLimitsSnapshot | null,
  ): AgentRuntime {
    return { id: `${provider}-${plan_limits?.observed_at ?? 0}`, provider, plan_limits } as AgentRuntime;
  }

  it("keeps the newest observation when several runtimes share a provider", () => {
    const older: PlanLimitsSnapshot = {
      ...SNAPSHOT,
      observed_at: NOW / 1000 - 600,
      windows: [{ ...SNAPSHOT.windows![0]!, used_percent: 10 }],
    };

    const [codex] = providerPlanLimits(
      [runtime("codex", older), runtime("codex", SNAPSHOT)],
      NOW,
    );

    expect(codex!.runtimeCount).toBe(2);
    expect(codex!.snapshot).toBe(SNAPSHOT);
    expect(codex!.windows[0]!.used_percent).toBe(42);
  });

  it("keeps a provider whose runtimes reported nothing", () => {
    const [grok] = providerPlanLimits([runtime("grok", null)], NOW);

    expect(grok!.provider).toBe("grok");
    expect(grok!.runtimeCount).toBe(1);
    expect(grok!.snapshot).toBeNull();
    expect(grok!.windows).toEqual([]);
  });

  it("drops an observation whose only window passed its reset boundary", () => {
    const [codex] = providerPlanLimits([runtime("codex", SNAPSHOT)], NOW + 61_000);

    expect(codex!.runtimeCount).toBe(1);
    expect(codex!.snapshot).toBeNull();
  });

  it("omits providers the workspace has no runtime for", () => {
    expect(providerPlanLimits([runtime("claude", SNAPSHOT)], NOW)).toEqual([]);
  });

  it("matches the provider name case-insensitively", () => {
    const [codex] = providerPlanLimits([runtime(" Codex ", SNAPSHOT)], NOW);

    expect(codex!.provider).toBe("codex");
    expect(codex!.runtimeCount).toBe(1);
  });
});

describe("remainingPercent", () => {
  it("mirrors the consumed percentage the provider reported", () => {
    expect(remainingPercent({ name: "primary", used_percent: 42 })).toBe(58);
  });

  it("reports nothing left for a window at or past its limit", () => {
    expect(remainingPercent({ name: "primary", used_percent: 100 })).toBe(0);
    expect(remainingPercent({ name: "primary", used_percent: 120 })).toBe(0);
  });

  it("reports no percentage when the provider reported only a limit", () => {
    expect(remainingPercent({ name: "primary" })).toBeNull();
  });
});

describe("remainingWindows", () => {
  it("keeps the windows carrying a percentage and drops the rest", () => {
    expect(
      remainingWindows([
        { name: "primary", used_percent: 42 },
        { name: "secondary" },
      ]),
    ).toEqual([
      { window: { name: "primary", used_percent: 42 }, percent: 58 },
    ]);
  });
});

describe("PlanLimitsCell", () => {
  it("renders the quota the Codex window has left", () => {
    const runtime = {
      plan_limits: SNAPSHOT,
    } as AgentRuntime;

    render(
      <I18nProvider locale="en" resources={{ en: { runtimes: enRuntimes } }}>
        <PlanLimitsCell runtime={runtime} now={NOW} />
      </I18nProvider>,
    );

    expect(screen.getByText("58% left")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
  });
});
