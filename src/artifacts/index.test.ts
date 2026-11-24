import { describe, expect, it } from "vitest";
import { buildSandboxedDocument } from "./index";

describe("artifacts sandbox", () => {
  it("inyecta CSP estricta sin scripts ni red", () => {
    const doc = buildSandboxedDocument({
      kind: "html",
      content: "<p>Vista previa</p>",
    });
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<p>Vista previa</p>");
  });
});
