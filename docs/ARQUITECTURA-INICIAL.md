# Pulso Desktop — Arquitectura y plan inicial

Aplicación de escritorio independiente (estilo Claude Desktop / OpenCode / Antigravity) centrada en el trabajo con agentes de IA, proyectos locales, artefactos y servidores MCP, sin arrastrar el editor de código completo de Pulso Editor.

## Decisiones clave

- **Repositorio independiente** de `Pulso Editor` (repositorio hermano) para mantener un instalador liviano, interfaz 100 % enfocada en el agente y ciclo de lanzamientos propio.
- **Stack:** Tauri v2 + Rust (backend, seguridad, agente, MCP, proveedores) + **TypeScript vanilla + Vite** (interfaz liviana sin frameworks pesados).
- **Idioma e i18n:** español por defecto en toda la interfaz y mensajes de Rust, con traducción al inglés desde el día 1 (`src/locales/en.ts` con diccionario por clave y fallback automático al español).
- **Seguridad desde el día 1:**
  - Carpetas de trabajo aprobadas únicamente desde el backend Rust (`fsguard`), validando rutas canonizadas y evitando escapes por `..` o enlaces simbólicos.
  - Confianza explícita por carpeta (`trusted-folders.json`) antes de cargar `AGENTS.md`, skills o ejecutar herramientas del proyecto.
  - Claves API guardadas en el almacén seguro del sistema operativo (`secrets` vía `keyring`), nunca expuestas al frontend.
  - Aprobación explícita de comandos y herramientas con reglas de permitir/denegar por proyecto (`una vez`, `sesión` o `siempre`).

## Qué se aprovecha de Pulso Editor (referencia)

Se pueden adaptar o portar las ideas y módulos ya validados en el repositorio hermano `Pulso Editor`:
- Motor de agente, herramientas, memoria por proyecto, `/plan`, subagentes y skills (`src-tauri/src/agent*.rs`).
- Proveedores de `models.dev`, streaming OpenAI/Anthropic/Ollama y detección de CLIs (`src-tauri/src/aichat/`).
- Seguridad de rutas y secretos (`src-tauri/src/fsguard.rs`, `src-tauri/src/secrets.rs`).

Quedan **fuera** a propósito: Monaco Editor, clientes LSP, depurador DAP, tablero/PRs de GitHub y árbol de archivos pesado.

## Contrato Frontend ↔ Backend (IPC)

- **Comandos tipados (`invoke`):** todas las operaciones de lectura/escritura, selección de workspace, configuración y gestión de sesiones pasan por comandos Tauri definidos en `src-tauri/src/`.
- **Streaming con `Channel`:** las respuestas en streaming del agente (tokens, llamadas a herramientas, deltas de artefactos) fluyen por `tauri::ipc::Channel` por ejecución (`run_id`), evitando saturar el bus global de eventos.
- **Cancelación cooperativa:** cada turno activo mantiene un identificador `run_id` cancelable desde la UI para detener streaming o procesos en curso de forma limpia.
- **Flujo de aprobación interactiva:** cuando una herramienta o comando requiere permiso, el backend pausa la ejecución del paso, envía una solicitud estructurada a la UI y espera la decisión del usuario (permitir una vez, permitir en sesión, permitir siempre en el proyecto o denegar).

## Persistencia local

Todos los datos de la aplicación viven bajo `app_data_dir()` de Tauri (nunca en rutas arbitrarias fuera del perfil del usuario):

- `settings.json`: preferencias generales (idioma, proveedor/modelo por defecto, tema, servidores MCP configurados).
- `trusted-folders.json`: registro explícito de carpetas confiables y reglas de permisos por proyecto.
- `conversations/<id>.json`: historial de conversaciones, metadatos del proyecto asociado y referencias a artefactos.
- `memory/<project-hash>.md`: notas/memoria persistente por proyecto (solo para carpetas confiables).

> En v0.1 se usa almacenamiento en archivos JSON/Markdown por simplicidad y transparencia; si el historial o búsqueda crece, se podrá migrar a SQLite sin cambiar el contrato IPC.

## Seguridad en artefactos, comandos y MCP

- **Aislamiento de artefactos (`HTML`/`SVG`):** cualquier previsualización HTML o SVG generada por el modelo se renderiza exclusivamente dentro de un `<iframe sandbox="...">` sin `allow-same-origin`, con CSP restrictiva y sin acceso a las APIs de Tauri (`__TAURI__`).
- **Ejecución de comandos locales:** preview exacto del comando y directorio de trabajo antes de aprobar, con timeout configurable, límite de bytes en `stdout`/`stderr` y terminación limpia del árbol de procesos al cancelar.
- **Servidores MCP (`stdio` / HTTP):** aprobación explícita por servidor y por herramienta; los procesos `stdio` se lanzan con entorno saneado (sin propagar variables sensibles del proceso ni secretos del almacén del SO salvo configuración explícita del usuario).

## Estrategia de pruebas

- **Frontend (`npm test`):** Vitest para lógica de estado, traducciones (`i18n`), sanitización/gestión de artefactos y utilidades de chat.
- **Backend (`npm run test:rust`):** `cargo test` con prioridad en pruebas de seguridad (`fsguard`: path traversal, rutas absolutas fuera de raíz, symlinks; `trusted_folders`: persistencia y verificación de confianza) y evaluación de permisos.

## Estructura objetivo

```text
Pulso-Desktop/
├── src-tauri/src/
│   ├── agent/          # loop del agente, herramientas, permisos, memoria, /plan
│   ├── providers/      # models.dev, streaming OpenAI/Anthropic/Ollama, CLIs
│   ├── mcp/            # cliente MCP (stdio / HTTP) con aprobación de herramientas
│   ├── security/       # fsguard, trusted folders, secrets
│   └── main.rs / lib.rs
├── src/
│   ├── chat/           # lista de conversaciones, mensajes, streaming, markdown
│   ├── artifacts/      # panel lateral de artefactos (diffs, código, tablas, HTML/SVG)
│   ├── workspace/      # selector de proyectos/carpetas activas y permisos
│   ├── settings/       # proveedores, claves, MCP, skills, idioma (es/en)
│   └── locales/        # traducciones (en.ts) e infraestructura i18n
└── docs/
    └── ARQUITECTURA-INICIAL.md
```

## MVP v0.1

1. **Esqueleto Tauri v2 + Vite + TypeScript + Vitest** con layout de 3 zonas: barra lateral de conversaciones/proyectos, hilo principal de chat y panel colapsable de artefactos/diffs.
2. **Multi-proveedor:** catálogo `models.dev` con claves en el almacén seguro del sistema + soporte local para Ollama.
3. **Herramientas locales con seguridad:** leer/buscar/editar archivos dentro de la carpeta aprobada, ejecutar comandos con aprobación y modo `/plan` en solo lectura.
4. **MCP y Skills:** conectar servidores MCP y cargar `AGENTS.md` / skills del proyecto (con confianza explícita).
