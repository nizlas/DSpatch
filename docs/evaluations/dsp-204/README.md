# DSP-204: DSpatch's app icon

Niclas chose the blue–turquoise interlaced DS with a glowing sphere in the middle, on a dark rounded plate, as DSpatch's app icon (12 November 2026). The original is [`app/build/icon-source/dspatch-icon.webp`](../../../app/build/icon-source/dspatch-icon.webp), kept as supplied. Its [README](../../../app/build/icon-source/README.md) says how the resources are generated.

## The original and its resources

- **The original.** A 1254×1254 WebP with alpha. Outside the plate it was already transparent: alpha 0, with a few stray pixels at alpha 1–2. The plate itself is near opaque (alpha 253). It had a transparent margin of about 8 % on each side; the plate spans x 97–1153 and y 102–1153.
- **Nothing redrawn.** `npm run icons` (`app/scripts/generate-icons.mjs`) keeps a 1065×1065 square around the plate. That is the plate plus its 4-pixel soft rim, and the margin outside it is cut away. The script then scales the square down with Lanczos-3 over premultiplied alpha. Nothing is redrawn or recoloured, and no plate, frame or shadow is added. Two runs give identical bytes.
- **The resources:**
  - `build/icons/16…512` for Linux;
  - `build/icon.ico` (16–256) for Windows;
  - `src/renderer/public/icons/dspatch-64/128/256.png` for the running client.

  The old green "D" (`build/icon.png`) is removed.
- **At every size** ([sizes-light-and-dark.png](sizes-light-and-dark.png); 16–48 also magnified four times):
  - the DS holds together down to 24 px;
  - at 16 px it reads as a blue DS mark on the dark plate, with the sphere no longer distinct;
  - nothing is clipped or stretched;
  - transparency outside the plate leaves no white or black rectangle on a light or a dark background;
  - on dark, the plate's rim stays visible as a thin edge.

## Where the icon is now

| Surface | How |
| --- | --- |
| **Linux launcher (desktop entry)** | The `.deb` installs `/usr/share/icons/hicolor/<n>x<n>/apps/dspatch.png` for 16–512, and `dspatch.desktop` says `Icon=dspatch`. |
| **Linux dock, taskbar and window switcher** | Every client window carries the icon itself (`_NET_WM_ICON`, 256 px): the main window, review (diff), walk, the discussion panel's own window, the loop editor and the host-browse dialog (the trial did not open the host-browse dialog). The desktop entry's `StartupWMClass` now matches the windows' class. |
| **Windows executable, shortcuts and installer** | `build/icon.ico`. Windows takes each window's and the taskbar's icon from the executable, so nothing is set per window there. |
| **About DSpatch** | The dialog shows the icon (64 px). |
| **Start page** | A discreet 56-pixel icon centred above the wordmark. |

**What stays as it was:**
- functional icons: tools, status, agents, and the start page's own small SVG icons;
- headings, buttons and panels;
- the app id `dev.dspatch.app`, user data in `~/.config/DSpatch`, the update flow and host behaviour.

There was no favicon to replace.

**A fix found on the way: the window class.** Before this change, the windows' X11 class was `dspatch`, but the desktop entry said `StartupWMClass=DSpatch`. A dock that matches on that field could not tie the windows to the entry and its icon.
- `package.json` now has `desktopName: dspatch.desktop`. electron-builder therefore writes `StartupWMClass=dspatch`, and Electron takes the Wayland app_id from the same name.
- The entry's file name stays `dspatch.desktop`.

## Verification

**Linux, `scripts/icon-trial.mjs` in linux-verify's `icons` job** (Xvfb, openbox, a tint2 panel; run 43309807897):
- **On this checkout's build: 29 of 29 checks.**
- **On the `.deb` built in the same job and installed on the runner: 42 of 42 checks.** These include:
  - the desktop entry's `Icon=dspatch`, `Exec` and `StartupWMClass=dspatch`;
  - all eight hicolor icons byte-identical to `build/icons`;
  - the installed client's own icon copies.
- **For each window** (main, review, walk and loop editor), on both runs:
  - its WM_CLASS is `dspatch`, as the entry says;
  - its `_NET_WM_ICON` is 256×256 and has the same pixels as `dspatch-256.png` at six sample points, within the 3-level rounding of premultiplied alpha.
- **The start page's icon** is 56×56, centred above the wordmark.

Screenshots of the X display with the installed package, in [linux-xvfb/](linux-xvfb/):
- `01-start-window-and-panel.png`: the start page, the window's title-bar icon, and the panel's launcher (from the desktop entry) and taskbar entry;
- `02-about-dialog.png`: About DSpatch with the icon;
- `03-review-walk-and-editor-windows.png` and `04-panel.png`: every window's taskbar entry with the icon;
- `05-window-switcher.png`: Openbox's Alt+Tab list, each window with the icon;
- `dspatch.desktop`: the installed entry.

**Windows**, built on Windows (`electron-builder --win --dir`, then the NSIS installer from it):
- The executable and the installer both carry the icon at 16, 24, 32, 48, 64, 128 and 256 px, read back with `PrivateExtractIcons`, with transparent corners. See [windows/exe-icons.png](windows/exe-icons.png) and [windows/installer-icons.png](windows/installer-icons.png).
- No Windows package is published, and the installed Windows program, its taskbar and its shortcuts were not seen.

**Other checks.** The type checks pass, as does the client boundary test, which lists `main/app-icon.ts`.

## Not established

- **GNOME's or KDE's own dock**, and Wayland: the Linux trials ran on X11 under Xvfb, with openbox and tint2. The window class and the desktop entry now match; how a given dock draws them was not seen.
- **Windows' taskbar, Start menu and desktop shortcut** of an installed DSpatch.
- **A development run on Windows** (`npm start`) still shows Electron's icon, since it runs `electron.exe`.
