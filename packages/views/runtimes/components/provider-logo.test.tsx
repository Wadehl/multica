// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { siOpenai, siSpacex } from "simple-icons";
import { describe, expect, it } from "vitest";
import { ProviderLogo } from "./provider-logo";

describe("ProviderLogo", () => {
  it("uses the Simple Icons OpenAI mark for Codex", () => {
    const { container } = render(<ProviderLogo provider="codex" />);

    expect(container.querySelector("path")?.getAttribute("d")).toBe(
      siOpenai.path,
    );
  });

  it("uses the Simple Icons SpaceX mark for Grok", () => {
    const { container } = render(<ProviderLogo provider="grok" />);

    expect(container.querySelector("path")?.getAttribute("d")).toBe(
      siSpacex.path,
    );
  });
});
