// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import type { SupportedLocale } from "@multica/core/i18n";
import type { ReactNode } from "react";
import { RESOURCES } from "../test/i18n";
import { useDateTime } from "./use-date-time";

// A fixed local instant, so the assertions below describe the formatter rather
// than the clock the suite happens to run on.
const BOUNDARY = new Date(2026, 8, 18, 14, 24).toISOString();

function wrapperFor(locale: SupportedLocale) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider locale={locale} resources={RESOURCES}>
        {children}
      </I18nProvider>
    );
  };
}

describe("useDateTime", () => {
  it("formats a boundary with the locale's own date and time rules", () => {
    const { result } = renderHook(() => useDateTime(), {
      wrapper: wrapperFor("en"),
    });

    expect(result.current(BOUNDARY)).toBe(
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(BOUNDARY)),
    );
  });

  it("follows the language the reader picked, not the browser's", () => {
    const zh = renderHook(() => useDateTime(), {
      wrapper: wrapperFor("zh-Hans"),
    });

    expect(zh.result.current(BOUNDARY)).toContain("月");
  });

  it("leaves the year out — every reported boundary is days away", () => {
    const { result } = renderHook(() => useDateTime(), {
      wrapper: wrapperFor("en"),
    });

    expect(result.current(BOUNDARY)).not.toContain("2026");
  });
});
