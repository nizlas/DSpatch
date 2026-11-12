import path from 'node:path';

import { nativeImage, type NativeImage } from 'electron';

/**
 * DSpatch's app icon for the running client (DSP-204): the copies scripts/generate-icons.mjs
 * derives from build/icon-source/dspatch-icon.webp into src/renderer/public/icons, which the
 * renderer build puts in dist/renderer/icons, beside this file's dist/main in development and in
 * an installation alike.
 */
export function appIcon(size: 64 | 128 | 256): NativeImage | null {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'icons', `dspatch-${String(size)}.png`));
  return image.isEmpty() ? null : image;
}

/**
 * A window's icon where the platform takes it from the window. On Linux the window manager reads
 * it from the window (_NET_WM_ICON), and the dock and the window switcher draw it; the installed
 * desktop entry gives the same icon by WM_CLASS. On Windows the executable's own icon (build/icon.ico)
 * is the window's and the taskbar's, at every size it has, so nothing is set there.
 */
export function windowIcon(): { readonly icon?: NativeImage } {
  if (process.platform !== 'linux') {
    return {};
  }
  const icon = appIcon(256);
  return icon === null ? {} : { icon };
}
