import { en } from "./en";

export type Locale = "es" | "en";

const es: Record<string, string> = {
  "app.title": "Pulso Desktop",
  "sidebar.newChat": "Nueva conversación",
  "sidebar.automations": "Automatizaciones",
  "sidebar.customizations": "Skills y MCP",
  "sidebar.projects": "Proyectos",
  "sidebar.noConversations": "Sin conversaciones aún",
  "sidebar.addProject": "Agregar carpeta de proyecto",
  "sidebar.settings": "Ajustes",
  "sidebar.trusted": "Confiable",
  "sidebar.untrusted": "Sin confianza",
  "sidebar.trustAction": "Confiar",
  "header.noProject": "Sin proyecto",
  "header.artifacts": "Revisar",
  "header.toggleSidebar": "Mostrar u ocultar barra lateral",
  "chat.emptyTitle": "¿En qué quieres trabajar hoy?",
  "chat.emptySubtitle":
    "Selecciona una carpeta de proyecto o escribe un mensaje. Usa /plan para explorar en modo solo lectura.",
  "chat.placeholder": "Pregunta lo que quieras, @ para mencionar, / para acciones",
  "chat.send": "Enviar",
  "chat.modeNormal": "Normal",
  "chat.modePlan": "/plan",
  "chat.workedFor": "Trabajó 1s",
  "chat.copyCode": "Copiar",
  "chat.copied": "Copiado",
  "chat.review": "Revisar",
  "chat.filesChanged": "archivos modificados",
  "chat.demoReply":
    "Entorno base listo. Configura un proveedor (Ollama, OpenAI o Anthropic) en Ajustes para activar respuestas reales del agente.",
  "artifacts.title": "Artefactos y revisión",
  "artifacts.empty":
    "Aquí aparecerán diffs, bloques de código, tablas y vistas previas HTML/SVG aisladas.",
  "artifacts.close": "Cerrar panel",
  "settings.language": "Idioma",
};

let currentLocale: Locale = "es";

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function t(key: string, locale: Locale = currentLocale): string {
  if (locale === "en" && key in en) {
    return en[key];
  }
  return es[key] ?? key;
}
