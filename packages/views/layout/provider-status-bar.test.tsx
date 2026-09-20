// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { AgentRuntime, PlanLimitsSnapshot } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ProviderStatusBar, ProviderStatusBarView } from "./provider-status-bar";

// The bar reads the wall clock, so the fixtures are anchored to it: a snapshot
// older than a day is treated as stale and drops out.
const NOW = Math.floor(Date.now() / 1000);
const RESET_AT = NOW + 3_600;

// The bar prints the reset boundary with the reader's locale rules, so the
// expectation is built the same way rather than pinned to one machine's
// timezone.
const RESET_LABEL = `Resets ${new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(RESET_AT * 1000))}`;

const CODEX_SNAPSHOT: PlanLimitsSnapshot = {
  provider: "codex",
  status: "available",
  observed_at: NOW,
  windows: [
    {
      name: "primary",
      used_percent: 42,
      window_minutes: 300,
      resets_at: RESET_AT,
    },
  ],
};

describe("ProviderStatusBarView", () => {
  it("renders no bar when the workspace runs no tracked provider", () => {
    const { container } = renderWithI18n(<ProviderStatusBarView providers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("labels the bar and lists the quota each provider window has left", () => {
    renderWithI18n(
      <ProviderStatusBarView
        providers={[
          {
            provider: "codex",
            runtimeCount: 1,
            snapshot: CODEX_SNAPSHOT,
            windows: CODEX_SNAPSHOT.windows!,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Provider quota status")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("58% left")).toBeInTheDocument();
    expect(screen.getByText(RESET_LABEL)).toBeInTheDocument();
  });

  it("reports a reached limit together with the moment it refreshes", () => {
    renderWithI18n(
      <ProviderStatusBarView
        providers={[
          {
            provider: "codex",
            runtimeCount: 1,
            snapshot: {
              provider: "codex",
              status: "exhausted",
              observed_at: NOW,
              windows: [
                {
                  name: "primary",
                  window_minutes: 300,
                  resets_at: RESET_AT,
                },
              ],
            },
            windows: [
              { name: "primary", window_minutes: 300, resets_at: RESET_AT },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("Limit reached")).toBeInTheDocument();
    expect(screen.getByText(RESET_LABEL)).toBeInTheDocument();
  });

  it("hides a provider that has not reported a snapshot", () => {
    renderWithI18n(
      <ProviderStatusBarView
        providers={[{ provider: "grok", runtimeCount: 1, snapshot: null, windows: [] }]}
      />,
    );

    expect(screen.queryByText("Grok")).not.toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  it("hides Claude when its subscription is not recognised", () => {
    renderWithI18n(
      <ProviderStatusBarView
        providers={[{ provider: "claude", runtimeCount: 1, snapshot: null, windows: [] }]}
      />,
    );

    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  it("reports a reached limit when the snapshot carries no percentage", () => {
    renderWithI18n(
      <ProviderStatusBarView
        providers={[
          {
            provider: "codex",
            runtimeCount: 1,
            snapshot: { provider: "codex", status: "exhausted", observed_at: NOW },
            windows: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("Limit reached")).toBeInTheDocument();
  });
});

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

// useQuery is stubbed so the bar renders its data synchronously, and only the
// runtime list is answered — the bar reads no other query.
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

describe("ProviderStatusBar", () => {
  it("reads the workspace runtimes and reports their quota", () => {
    runtimeFixtures.runtimes = [
      { id: "rt-0", provider: "claude", plan_limits: null } as AgentRuntime,
      { id: "rt-1", provider: "codex", plan_limits: CODEX_SNAPSHOT } as AgentRuntime,
      { id: "rt-2", provider: "grok", plan_limits: null } as AgentRuntime,
    ];

    renderWithI18n(<ProviderStatusBar />);

    expect(screen.getByLabelText("Provider quota status")).toBeInTheDocument();
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.queryByText("Grok")).not.toBeInTheDocument();
  });

  it("renders no bar when the workspace has no runtimes", () => {
    runtimeFixtures.runtimes = [];

    const { container } = renderWithI18n(<ProviderStatusBar />);

    expect(container).toBeEmptyDOMElement();
  });
});
