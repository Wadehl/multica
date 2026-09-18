// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import type { ReactNode } from "react";
import { RESOURCES } from "../test/i18n";
import { useTimeUntil } from "./use-time-until";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={RESOURCES}>
      {children}
    </I18nProvider>
  );
}

// A deadline lands on a boundary; the hook reads the clock a moment later, so
// each offset carries slack to keep the unit from slipping one step down.
function at(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 30_000).toISOString();
}

describe("useTimeUntil", () => {
  it("counts a future deadline up in the largest fitting unit", () => {
    const { result } = renderHook(() => useTimeUntil(), { wrapper });

    expect(result.current(at(30 * 60 * 1000))).toBe("in 30m");
    expect(result.current(at(5 * 60 * 60 * 1000))).toBe("in 5h");
    expect(result.current(at(3 * 24 * 60 * 60 * 1000))).toBe("in 3d");
  });

  it("collapses a deadline already inside the minute to a single phrase", () => {
    const { result } = renderHook(() => useTimeUntil(), { wrapper });

    expect(result.current(new Date(Date.now() + 20_000).toISOString())).toBe(
      "any moment",
    );
    expect(result.current(new Date(Date.now() - 60_000).toISOString())).toBe(
      "any moment",
    );
  });
});
