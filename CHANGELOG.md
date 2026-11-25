# Changelog — Pulso Desktop

## [Sin publicar]

### Añadido
- **El uso de los planes se actualiza solo.** La tarjeta de los ajustes muestra Claude, Codex y Antigravity (antes solo Antigravity, y a mano). Se consulta al abrir la aplicación, durante una respuesta (cada 45 segundos) y al terminarla, cada 2 minutos en reposo y al volver a la ventana. Con la ventana oculta o minimizada no hay consultas periódicas.

### Corregido
- Los ajustes mostraban «Versión instalada: v0.3.0» en cualquier versión.

## [0.3.1] - 2026-11-25

### Seguridad
- **Las actualizaciones se verifican con firma.** El actualizador anterior descargaba el instalador y lo ejecutaba sin comprobar nada más que la dirección. Ahora usa el actualizador de Tauri: el instalador tiene que venir firmado con la clave de Pulso Desktop o se rechaza antes de ejecutarlo.

### Cambiado
- Las actualizaciones se leen de las releases de **este** repositorio (`latest.json` de la release «Latest»), no de las del Editor.
- Al instalar una actualización se detienen las respuestas de IA en marcha y la aplicación se reinicia sola.
- Los instaladores los construye y firma la CI (`.github/workflows/release.yml`). Ver [Distribución](docs/DISTRIBUCION.md).

> La 0.3.0 no puede actualizarse sola a esta versión: hay que instalar la 0.3.1 a mano una vez.

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
