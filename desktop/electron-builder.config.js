/**
 * electron-builder configuration for ERP Warehouse
 * Microsoft Store MSIX / APPX package
 *
 * BEFORE BUILDING FOR STORE:
 *   1. In Microsoft Partner Center → Apps → Reserve "ERP Warehouse"
 *   2. Go to App identity page — copy the three values below:
 *      - Package/Identity/Name        → appx.identityName
 *      - Package/Properties/Publisher → appx.publisher  (CN=... string)
 *      - Package/Properties/Publisher Display Name → appx.publisherDisplayName
 *   3. Replace the PLACEHOLDER_ values in the appx section.
 *   4. Run: npm run build:unsigned   (Partner Center re-signs on upload)
 */

module.exports = {
  appId: 'com.hmdinternationalgroup.erpwarehouse',
  productName: 'ERP Warehouse',
  copyright: 'Copyright © 2025 HMD International Group',

  directories: {
    output: 'dist',
    buildResources: 'build',
  },

  files: [
    'main.js',
    'preload.js',
    'offline.html',
    'icons/**/*',
    'package.json',
    '!node_modules/**/*',
    '!dist/**/*',
    '!scripts/**/*',
  ],

  extraMetadata: {
    version: process.env.APP_VERSION || require('./package.json').version,
  },

  win: {
    target: [
      { target: 'appx', arch: ['x64'] },
    ],
    icon: 'icons/icon.ico',
    publisherName: 'HMD International Group',
    signingHashAlgorithms: ['sha256'],
  },

  appx: {
    // ─── Replace these three values with your Partner Center identity ──────
    identityName:       'PLACEHOLDER_IdentityName',
    publisher:          'PLACEHOLDER_CN=YourPublisherCertificateSubject',
    publisherDisplayName: 'HMD International Group',
    // ───────────────────────────────────────────────────────────────────────

    applicationId:    'ERPWarehouse',
    displayName:      'ERP Warehouse',
    description:      'Multi-company ERP and POS system for warehouse and inventory management by HMD International Group.',
    backgroundColor:  '#0f172a',
    showNameOnTiles:  true,
    languages:        ['en-US'],
    minVersion:       '10.0.17763.0',

    assets: 'icons/store',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'icons/icon.ico',
    uninstallerIcon: 'icons/icon.ico',
    installerHeaderIcon: 'icons/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'ERP Warehouse',
  },
};
