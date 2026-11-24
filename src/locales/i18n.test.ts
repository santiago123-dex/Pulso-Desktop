import { describe, expect, it } from "vitest";
import { getLocale, setLocale, t } from "./i18n";

describe("i18n", () => {
  it("usa español por defecto", () => {
    setLocale("es");
    expect(getLocale()).toBe("es");
    expect(t("sidebar.newChat")).toBe("Nueva conversación");
  });

  it("traduce al inglés cuando se cambia el idioma", () => {
    setLocale("en");
    expect(t("sidebar.newChat")).toBe("New Conversation");
    setLocale("es");
  });

  it("devuelve la clave si no existe traducción", () => {
    expect(t("clave.inexistente")).toBe("clave.inexistente");
  });
});
