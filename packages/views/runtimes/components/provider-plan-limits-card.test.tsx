// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { AgentRuntime, PlanLimitsSnapshot } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { ProviderPlanLimitsCard } from "./provider-plan-limits-card";

// The card reads the wall clock, so the fixtures are anchored to it: a
// snapshot older than a day is treated as stale and drops out.
const NOW = Math.floor(Date.now() / 1000);
const RESET_AT = NOW + 2 * 24 * 60 * 60;

const GROK_SNAPSHOT: PlanLimitsSnapshot = {
  provider: "grok",
  status: "available",
  observed_at: NOW,
  windows: [
    {
      name: "weekly",
      used_percent: 61,
      window_minutes: 10_080,
      resets_at: RESET_AT,
    },
  ],
};

const runtimeFixtures = vi.hoisted(() => ({ runtimes: [] as AgentRuntime[] }));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/runtimes/queries", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/runtimes/queries")>(
    "@multica/core/runtimes/queries",
  );
  return {
    runtimeListOptions: (wsId: string) => ({
      queryKey: actual.runtimeKeys.list(wsId),
    }),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) =>
      options.queryKey?.[0] === "runtimes"
        ? { data: runtimeFixtures.runtimes, isLoading: false }
        : { data: [], isLoading: false },
  };
});

describe("ProviderPlanLimitsCard", () => {
  it("renders nothing when the workspace runs no tracked provider", () => {
    runtimeFixtures.runtimes = [];

    const { container } = renderWithI18n(<ProviderPlanLimitsCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders one block per provider with the quota it has left", () => {
    runtimeFixtures.runtimes = [
      { id: "rt-1", provider: "grok", plan_limits: GROK_SNAPSHOT } as AgentRuntime,
    ];

    renderWithI18n(<ProviderPlanLimitsCard />);

    expect(screen.getByText("Plan limits")).toBeInTheDocument();
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.getByText("7-day window")).toBeInTheDocument();
    expect(screen.getByText("39% left")).toBeInTheDocument();
    // The reset boundary carries both the wall-clock moment and how long is
    // left of it; the count is matched loosely because the render lands a
    // moment after the fixture is anchored.
    expect(screen.getByText(/^Resets .+ · in \d+d$/)).toBeInTheDocument();
  });

  it("reports a supported provider that has reported no snapshot", () => {
    runtimeFixtures.runtimes = [
      { id: "rt-1", provider: "codex", plan_limits: null } as AgentRuntime,
    ];

    renderWithI18n(<ProviderPlanLimitsCard />);

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Plan limits unavailable")).toBeInTheDocument();
  });
});
