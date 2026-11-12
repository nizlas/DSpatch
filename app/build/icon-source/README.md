# DSpatch's app icon

`dspatch-icon.webp` is the original of DSpatch's app icon: the blue–turquoise interlaced DS with a glowing sphere in the middle, on a dark rounded plate. Niclas chose it on 12 November 2026 (DSP-204). It is kept exactly as it was supplied, and it is the only original: every icon file in the repository is derived from it. Do not edit the derived files by hand.

## Regenerate the resources

After changing the original, run from `app/`:

```bash
npm run icons
```

`scripts/generate-icons.mjs` decodes the original in Electron and cuts away the empty transparent margin around the plate. It keeps the plate's edges and their soft rim. It scales the square that remains down with a Lanczos-3 filter over premultiplied alpha. It adds no background, frame or shadow, and the output is the same on every run.

It writes:

| File | Used by |
| --- | --- |
| `build/icons/<n>x<n>.png` (16–512) | The Linux `.deb`. It installs them as `/usr/share/icons/hicolor/<n>x<n>/apps/dspatch.png` for the desktop entry's `Icon=dspatch`. |
| `build/icon.ico` (16–256) | The Windows executable, its shortcuts and the installer. |
| `src/renderer/public/icons/dspatch-<n>.png` (64, 128, 256) | The running client: the window icon on Linux, *About DSpatch* and the start page. Vite copies them to `dist/renderer/icons`. |

`npm run icons -- --sheet <file.png>` also draws every size on a light and a dark background, for inspection.

`scripts/icon-trial.mjs` checks the result on Linux. It runs in linux-verify's `icons` job, against the build and against the installed `.deb`.
