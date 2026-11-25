import { describe, expect, it, vi } from "vitest";
import type { QuotaGroup } from "./index";
import { createUsageTracker, renderUsageBody, resetTimeMs } from "./usage";

const NOW = Date.parse("2026-11-25T15:00:00Z");
const quota = (left: number, resetTime = ""): QuotaGroup[] => [
  { name: "Claude", buckets: [{ name: "", window: "5h", remainingPercent: left, resetTime }] },
];

describe("seguimiento del uso", () => {
  it("no repite una consulta reciente, pero sí cuando ya es vieja", async () => {
    let clock = NOW;
    const fetch = vi.fn(async () => quota(80));
    const tracker = createUsageTracker(fetch, () => {}, () => clock);

    await tracker.refresh(["anthropic"], 60_000);
    clock += 30_000;
    await tracker.refresh(["anthropic"], 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    clock += 30_000;
    await tracker.refresh(["anthropic"], 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("si termina una respuesta durante una consulta, consulta otra vez al acabar", async () => {
    const pending: Array<(v: QuotaGroup[]) => void> = [];
    const fetch = vi.fn(() => new Promise<QuotaGroup[]>((resolve) => pending.push(resolve)));
    const tracker = createUsageTracker(fetch, () => {});

    const first = tracker.refresh(["openai"], 0);
    const second = tracker.invalidate("openai");
    expect(fetch).toHaveBeenCalledTimes(1);

    pending[0](quota(90));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    pending[1](quota(70));
    await Promise.all([first, second]);
    expect(tracker.get("openai")?.groups[0].buckets[0].remainingPercent).toBe(70);
  });

  it("un fallo conserva las últimas cifras y lo dice", async () => {
    let clock = NOW;
    let fail = false;
    const tracker = createUsageTracker(
      async () => {
        if (fail) throw "sin conexión";
        return quota(42);
      },
      () => {},
      () => clock,
    );
    await tracker.invalidate("anthropic");
    fail = true;
    clock += 3 * 60_000;
    await tracker.invalidate("anthropic");

    const html = renderUsageBody([{ id: "anthropic", name: "Anthropic" }], tracker, "es", clock);
    expect(html).toContain("42% disp.");
    expect(html).toContain("No se pudo actualizar: sin conexión · Actualizado hace 3 min");
  });
});

describe("hora de reinicio", () => {
  it("entiende los tres formatos", () => {
    const expected = Date.parse("2026-11-25T16:59:00Z");
    expect(resetTimeMs("Nov 25, 11:59am (America/Bogota)", NOW)).toBe(expected);
    expect(resetTimeMs(String(expected / 1000), NOW)).toBe(expected);
    expect(resetTimeMs("2026-11-25T16:59:00Z", NOW)).toBe(expected);
  });

  it("pasa de diciembre a enero y descarta lo que no es una fecha", () => {
    const december = Date.parse("2026-12-31T12:00:00Z");
    expect(resetTimeMs("Jan 2, 3pm (UTC)", december)).toBe(Date.parse("2027-01-02T15:00:00Z"));
    expect(resetTimeMs("1970-01-01T00:00:00Z", NOW)).toBe(0);
    expect(resetTimeMs("pronto", NOW)).toBe(0);
    expect(resetTimeMs("", NOW)).toBe(0);
  });
});

describe("tarjeta de uso", () => {
  it("sin cuentas explica qué hacer y escapa los textos de la herramienta", async () => {
    const tracker = createUsageTracker(
      async () => {
        throw new Error("<img src=x>");
      },
      () => {},
    );
    expect(renderUsageBody([], tracker, "es")).toContain("Inicia sesión");
    await tracker.invalidate("openai");
    const html = renderUsageBody([{ id: "openai", name: "OpenAI" }], tracker, "es");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
