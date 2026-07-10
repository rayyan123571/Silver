# App icon / installer resources

electron-builder reads packaging resources from this folder (`directories.buildResources`).

## App icon (optional but recommended for delivery)
Drop a Windows icon here named exactly:

    build/icon.ico

- Format: `.ico` containing at least a 256×256 image (also include 48, 32, 16 px).
- electron-builder picks it up automatically — no config change needed.
- If no `icon.ico` is present, electron-builder falls back to the default Electron
  icon; the installer and app still build and run correctly (just unbranded).

To generate one from a PNG (256×256) you can use any online PNG→ICO converter or
ImageMagick: `magick icon.png -define icon:auto-resize=256,48,32,16 icon.ico`.
