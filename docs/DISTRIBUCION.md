# Distribución y actualizaciones de Pulso Desktop

Pulso Desktop se actualiza solo con el actualizador de Tauri: lee `latest.json` de la release marcada **«Latest»** de este repositorio, **comprueba la firma** del instalador con la clave pública que lleva dentro y, si la persona acepta, lo instala y reinicia. Un instalador sin una firma válida se rechaza antes de ejecutarse.

Las releases viven en **este** repositorio, no en `Pulso-Editor-releases`: los dos programas usan etiquetas `vX.Y.Z` y la marca «Latest», y compartir repositorio haría que se pisaran.

## La clave de firma (una sola vez)

Hace falta un par de claves **propio del Desktop**. La clave privada firma; la pública va dentro de la aplicación.

1. Genera el par (pide una contraseña; usa una y guárdala):

   ```powershell
   npx tauri signer generate -w "$env:USERPROFILE\.tauri\pulso-desktop.key"
   ```

   Crea `pulso-desktop.key` (privada) y `pulso-desktop.key.pub` (pública).

2. Copia el contenido de `pulso-desktop.key.pub` en `plugins.updater.pubkey` de `src-tauri/tauri.conf.json` y súbelo en un commit. La clave pública no es secreta.

3. Guarda la privada y su contraseña como secretos del repositorio (el segundo comando pide la contraseña):

   ```powershell
   Get-Content "$env:USERPROFILE\.tauri\pulso-desktop.key" -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo santiago123-dex/Pulso-Desktop
   ```

   ```powershell
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo santiago123-dex/Pulso-Desktop
   ```

> **Guarda una copia de la clave privada y su contraseña en un sitio seguro** (un gestor de contraseñas, por ejemplo). Si se pierde, las instalaciones existentes no aceptarán ninguna actualización firmada con otra clave: habría que pedir a cada persona que reinstale. No la subas nunca al repositorio.

## Publicar una versión

1. Sube la versión en `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` y `src-tauri/tauri.conf.json`, y anota los cambios en `CHANGELOG.md`.
2. Con eso unido a `main`, sube la etiqueta: `git tag vX.Y.Z` y `git push origin vX.Y.Z`.
3. El flujo «Publicación» comprueba la etiqueta y las claves, corre las pruebas, compila, firma y deja un **borrador** de release.
4. Revisa el borrador (el instalador `.exe`, su `.sig` y `latest.json`) y **publícalo como «Latest»**. Mientras sea borrador, ninguna instalación lo ve.

## Primera vez

La 0.3.0 publicada no verifica firmas y lee las releases del repositorio del Editor, así que **no puede actualizarse sola a la versión firmada**: la 0.3.1 hay que instalarla a mano una vez. A partir de ahí se actualiza sola. La release antigua del Desktop en `Pulso-Editor-releases` conviene dejarla como está (no marcada «Latest») o borrarla.

## Qué no cubre

La firma de actualización no es la firma de Windows (Authenticode): SmartScreen seguirá mostrando su advertencia al instalar.
