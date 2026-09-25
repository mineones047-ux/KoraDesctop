/**
 * electron-builder `afterPack` hook: embeds build-assets/icon.ico into the
 * packaged Kora.exe via the `rcedit` npm package.
 *
 * Why not `signAndEditExecutable: true`? That path downloads the winCodeSign
 * bundle, whose 7z archive cannot be extracted without symlink privileges
 * (ERROR: Cannot create symbolic link ... libcrypto.dylib) - the same failure
 * that originally forced `signAndEditExecutable: false` on this project.
 * rcedit only needs a single small exe, so it works without those rights.
 * Code signing itself is intentionally NOT done here (needs a real
 * certificate - see docs/ROADMAP.md section 10).
 */
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const productName = context.packager.appInfo.productFilename
  const exePath = path.join(context.appOutDir, productName + '.exe')
  const iconPath = path.join(context.packager.projectDir, 'build-assets', 'icon.ico')

  try {
    if (!fs.existsSync(exePath)) {
      console.warn('[afterPack] exe not found, skipping icon: ' + exePath)
      return
    }
    if (!fs.existsSync(iconPath)) {
      console.warn('[afterPack] icon not found, skipping: ' + iconPath)
      return
    }
    // rcedit@5 is ESM-only: load it with a dynamic import from this CJS hook.
    const mod = await import('rcedit')
    const apply = typeof mod.rcedit === 'function' ? mod.rcedit : mod.default
    await apply(exePath, { icon: iconPath })
    console.log('[afterPack] icon embedded via rcedit -> ' + exePath)
  } catch (error) {
    // An icon is not worth failing the whole release build over.
    console.warn('[afterPack] rcedit failed, keeping the default icon: ' + error.message)
  }
}