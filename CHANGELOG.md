# Changelog — Pulso Desktop

## [0.3.0] - 2026-11-24

Primer lanzamiento instalable de **Pulso Desktop**, diseñado como aplicación de escritorio liviana enfocada en agentes de IA, proyectos locales, artefactos y servidores MCP, integrada con **Pulso Editor** y la CLI `pulso`.

### Novedades principales
- **Interfaz de escritorio oscura sin bordes (Tauri v2 + Vite + TypeScript):**
  - Barra superior oscura integrada con menús funcionales (`Proyecto`, `Ver`, `Ventana`), logo de Pulso y controles nativos de ventana.
  - Layout de 3 zonas: barra lateral de proyectos/conversaciones, hilo central con animaciones (*motions*) y panel derecho colapsable de artefactos/revisión.
  - Español por defecto con cambio instantáneo a inglés (`ES / EN`).
- **Proveedores, cuentas y herencia desde Pulso Editor:**
  - Detección automática de cuentas conectadas (**Antigravity**, **OpenAI / Codex**, **Anthropic / Claude**) y modelos locales de **Ollama**.
  - Herencia automática de claves API guardadas en **Pulso Editor** (`pulso-editor`) y variables de entorno, más gestión segura en el almacén de credenciales del SO desde **Ajustes**.
  - Consulta de cuotas disponibles de Antigravity con barras de consumo en **Ajustes**.
- **Streaming real, herramientas, diffs y fotos:**
  - Respuestas en streaming en vivo por `tauri::ipc::Channel` con cancelación instantánea, bloques colapsables de pensamiento y píldoras de herramientas en ejecución.
  - Cálculo automático de cambios (`git diff`) al finalizar turnos en modo normal con tarjeta **`X archivos modificados +N -M`** y botón **`Revisar`**.
  - Soporte para adjuntar fotos mediante botón, pegado (`Ctrl+V`) o arrastrar y soltar, con visor ampliado (*lightbox*).
  - Autocompletado `@archivo` (protegido por `FsGuard`) y comandos `/` (`/plan`, `/normal`, `/nuevo`, `/limpiar`, `/ajustes`).
- **Artefactos, Automatizaciones, Skills y MCP:**
  - Previsualización aislada de bloques `HTML` y `SVG` en `<iframe sandbox="">` dentro del panel de Artefactos.
  - Persistencia local atómica (`desktop-state.json`) para proyectos, conversaciones, servidores MCP y automatizaciones reutilizables.
  - Inspección de `AGENTS.md` y skills del proyecto condicionada a confianza explícita (`trusted-folders.json`), más botón **Abrir en Pulso Editor**.
