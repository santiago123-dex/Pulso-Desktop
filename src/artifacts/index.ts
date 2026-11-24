export type ArtifactKind = "code" | "diff" | "table" | "html" | "svg";

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  language?: string;
}

/**
 * Envuelve contenido HTML/SVG en un documento aislado con CSP estricta
 * para renderizarse dentro de un `<iframe sandbox="">` sin acceso a Tauri.
 */
export function buildSandboxedDocument(artifact: Pick<Artifact, "kind" | "content">): string {
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;";
  const body =
    artifact.kind === "svg"
      ? `<div style="display:grid;place-items:center;min-height:100vh;">${artifact.content}</div>`
      : artifact.content;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
  </head>
  <body>${body}</body>
</html>`;
}
