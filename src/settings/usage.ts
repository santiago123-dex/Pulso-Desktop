/** Uso del plan de las cuentas conectadas: cuándo consultarlo, guardarlo y mostrarlo. */

import { escapeHtml } from "../chat";
import type { Locale } from "../locales/i18n";
import type { QuotaGroup } from "./index";

/** Cada cuánto se revisa si toca consultar y se repinta la antigüedad. */
export const TICK_MS = 15_000;
/** Antigüedad máxima de las cifras mientras hay una respuesta en curso. */
export const RUNNING_MS = 45_000;
/** Antigüedad máxima en reposo, para recoger el uso gastado fuera de Pulso. */
export const IDLE_MS = 120_000;
/** Al volver a la ventana o abrir los ajustes, no se repite una consulta más reciente que esto. */
export const RETURN_MS = 20_000;

export interface ProviderUsage {
  groups: QuotaGroup[];
  /** Momento de la última lectura correcta; 0 si todavía no hubo ninguna. */
  updatedAt: number;
  attemptedAt: number;
  loading: boolean;
  error: string;
}

export interface UsageTracker {
  get(providerId: string): ProviderUsage | undefined;
  /** Consulta los proveedores cuyo último intento tenga al menos `minAgeMs`. */
  refresh(providerIds: string[], minAgeMs: number): Promise<void>;
  /** El uso acaba de cambiar: consulta ya y, si había una consulta en curso, repite al terminar. */
  invalidate(providerId: string): Promise<void>;
}

export function createUsageTracker(
  fetchUsage: (providerId: string) => Promise<QuotaGroup[]>,
  onChange: () => void,
  now: () => number = Date.now,
): UsageTracker {
  const states = new Map<string, ProviderUsage>();
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();

  function load(providerId: string): Promise<void> {
    const current = running.get(providerId);
    if (current) return current;

    const state = states.get(providerId) ?? { groups: [], updatedAt: 0, attemptedAt: 0, loading: false, error: "" };
    states.set(providerId, state);
    state.loading = true;
    state.attemptedAt = now();
    onChange();

    const task = (async () => {
      try {
        state.groups = await fetchUsage(providerId);
        state.updatedAt = now();
        state.error = "";
      } catch (e) {
        // Se conservan las últimas cifras buenas; la tarjeta avisa de que no son de ahora.
        state.error = e instanceof Error ? e.message : String(e);
      } finally {
        state.loading = false;
        running.delete(providerId);
        onChange();
      }
      if (again.delete(providerId)) await load(providerId);
    })();
    running.set(providerId, task);
    return task;
  }

  return {
    get: (providerId) => states.get(providerId),
    async refresh(providerIds, minAgeMs) {
      await Promise.all(
        providerIds
          .filter((id) => {
            const state = states.get(id);
            return !state || now() - state.attemptedAt >= minAgeMs;
          })
          .map(load),
      );
    },
    invalidate(providerId) {
      if (running.has(providerId)) again.add(providerId);
      return load(providerId);
    },
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Diferencia (ms) entre la hora de `timeZone` y UTC en ese instante. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  for (const p of format.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return wall - Math.floor(utcMs / 60_000) * 60_000;
}

/** «Nov 25, 11:59am (America/Bogota)», como lo escribe Claude Code. */
function parseClaudeReset(raw: string, nowMs: number): number {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?$/i.exec(raw);
  if (!m) return 0;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return 0;
  const hour = (Number(m[3]) % 12) + (m[5].toLowerCase() === "pm" ? 12 : 0);
  const minute = m[4] ? Number(m[4]) : 0;
  const zone = m[6]?.trim();

  const toUtc = (year: number): number => {
    const guess = Date.UTC(year, month, Number(m[2]), hour, minute);
    if (zone) {
      try {
        return guess - zoneOffsetMs(guess - zoneOffsetMs(guess, zone), zone);
      } catch {
        // Zona desconocida: se interpreta como hora local.
      }
    }
    return new Date(year, month, Number(m[2]), hour, minute).getTime();
  };

  const year = new Date(nowMs).getUTCFullYear();
  const ms = toUtc(year);
  // El texto no trae el año: una fecha muy anterior a hoy es de enero del año siguiente.
  return ms < nowMs - 7 * 86_400_000 ? toUtc(year + 1) : ms;
}

/** Momento del reinicio en milisegundos (segundos Unix, ISO-8601 o texto de Claude); 0 si no hay. */
export function resetTimeMs(raw: string, nowMs: number): number {
  const text = raw.trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const ms = Date.parse(text);
    // Antigravity manda 1970-01-01 en las ventanas que aún no se han usado.
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return parseClaudeReset(text, nowMs);
}

function resetLabel(raw: string, locale: Locale, nowMs: number): string {
  const ms = resetTimeMs(raw, nowMs);
  if (ms <= nowMs) return "";
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date(nowMs).toDateString();
  const when = date.toLocaleString(locale, {
    ...(sameDay ? {} : { weekday: "short", day: "numeric", month: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
  return locale === "en" ? `Resets ${when}` : `Se reinicia: ${when}`;
}

function windowLabel(window: string, fallback: string, locale: Locale): string {
  if (window === "5h") return locale === "en" ? "5-hour limit" : "Límite de 5 h";
  if (window === "weekly") return locale === "en" ? "Weekly limit" : "Límite semanal";
  return fallback || window;
}

export function ageLabel(updatedAt: number, locale: Locale, nowMs: number): string {
  const minutes = Math.floor((nowMs - updatedAt) / 60_000);
  if (minutes < 1) return locale === "en" ? "Updated just now" : "Actualizado ahora mismo";
  return locale === "en" ? `Updated ${minutes} min ago` : `Actualizado hace ${minutes} min`;
}

function renderProvider(name: string, state: ProviderUsage | undefined, locale: Locale, nowMs: number): string {
  const groups = (state?.groups ?? [])
    .map((group) => {
      const rows = group.buckets
        .map((b) => {
          const left = Math.max(0, Math.min(100, Math.round(b.remainingPercent)));
          const reset = resetLabel(b.resetTime, locale, nowMs);
          return `
            <div class="quota-row">
              <div class="quota-row-top">
                <span>${escapeHtml(windowLabel(b.window, b.name, locale))}</span>
                <span>${left}% ${locale === "en" ? "left" : "disp."}</span>
              </div>
              <div class="quota-bar"><div class="quota-fill" style="width:${left}%;"></div></div>
              ${reset ? `<div class="quota-reset">${escapeHtml(reset)}</div>` : ""}
            </div>`;
        })
        .join("");
      // Solo Antigravity reparte la cuota en varios grupos con nombre propio.
      const title = group.name && state && state.groups.length > 1 ? `<div class="quota-reset">${escapeHtml(group.name)}</div>` : "";
      return `${title}${rows}`;
    })
    .join("");

  let status = "";
  if (state?.error) {
    const stale = state.updatedAt ? ` · ${ageLabel(state.updatedAt, locale, nowMs)}` : "";
    status = `${locale === "en" ? "Could not update" : "No se pudo actualizar"}: ${state.error}${stale}`;
  } else if (state?.updatedAt) {
    status = ageLabel(state.updatedAt, locale, nowMs);
  } else {
    status = locale === "en" ? "Checking…" : "Consultando…";
  }

  return `
    <div class="quota-group">
      <div class="quota-name">${escapeHtml(name)}</div>
      ${groups}
      <div class="quota-reset">${escapeHtml(status)}</div>
    </div>`;
}

/** Contenido de la tarjeta «Uso de los planes». */
export function renderUsageBody(
  accounts: Array<{ id: string; name: string }>,
  tracker: UsageTracker,
  locale: Locale,
  nowMs: number = Date.now(),
): string {
  if (accounts.length === 0) {
    return `<div class="provider-card-sub">${
      locale === "en"
        ? "Sign in with Claude, Codex or Antigravity to see your plan usage here."
        : "Inicia sesión en Claude, Codex o Antigravity para ver aquí el uso de tu plan."
    }</div>`;
  }
  return accounts.map((a) => renderProvider(a.name, tracker.get(a.id), locale, nowMs)).join("");
}
