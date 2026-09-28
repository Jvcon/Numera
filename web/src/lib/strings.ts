/**
 * Numera web — user-facing UI strings (English).
 *
 * Single source of truth for web UI copy. Static labels are plain strings;
 * interpolated messages are small pure functions. Future locales can be added
 * by layering a translated object over this one (same keys) and selecting it
 * at runtime — no component changes required.
 *
 * Scope: all Lit components under `web/src/components`. Dynamic content that
 * originates from user data (file names, engine messages, template names) is
 * not listed here.
 */

export const STRINGS = {
  topBar: {
    openSidebar: 'Open sidebar',
    closeSidebar: 'Close sidebar',
    globalsTitle: 'Globals',
    newFromTemplate: 'New from template',
    exitGlobals: 'Exit globals',
    globalVariables: 'Global variables',
  },

  fab: {
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    newFile: 'New file',
    newDraft: 'New draft',
    command: 'Command',
    template: 'Template',
  },

  statusBar: {
    commandHint: 'Press Ctrl+K for commands',
    errorPrefix: '⚠ ',
  },

  command: {
    label: 'Command',
    placeholder: 'Command',
    groupFiles: 'Files',
    groupCommands: 'Commands',
    noMatches: (query: string) => `No matches for “${query}”`,
    newFile: 'New file',
    newFileDetail: 'Create a new .numr file',
    toggleTheme: 'Toggle theme',
    toggleThemeDetail: (theme: string) => `Current theme: ${theme}`,
    fromTemplate: 'New from template',
    fromTemplateDetail: 'Create a new file from a scenario template',
  },

  templateChooser: {
    title: 'New from template',
    close: 'Close',
    empty: 'No templates available',
  },

  appShell: {
    created: (name: string) => `Created ${name}`,
    copied: (value: string) => `Copied ${value}`,
    alreadyUpToDate: 'Already up to date',
    synced: (pushed: number, pulled: number, conflicts: number, deleted: number) => {
      let summary = `Synced: ${pushed} up, ${pulled} down`;
      if (conflicts > 0) {
        summary += `, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`;
      }
      if (deleted > 0) summary += `, ${deleted} deleted`;
      return summary;
    },
    syncFailed: (message: string) => `Sync failed: ${message}`,
  },

  sidebar: {
    collapseToggle: 'Toggle sidebar',
    brand: 'Numera',
    newFolder: 'New folder',
    settings: 'Settings',
    toggleTheme: 'Toggle theme',
    emptyTitle: 'No files yet',
    emptyBody: 'Your .numr files will appear here once your workspace is connected.',
    dragToReorder: 'Drag to reorder',
    moreActions: 'More actions',
    fileActions: 'File actions',
    folderActions: 'Folder actions',
    unpin: 'Unpin',
    pin: 'Pin',
    unpinFile: 'Unpin file',
    unpinFolder: 'Unpin folder',
    rename: 'Rename',
    renameFile: 'Rename file',
    renameFolder: 'Rename folder',
    name: 'Name',
    moveToFolder: 'Move to folder',
    noFolder: 'No folder',
    newFolderEllipsis: 'New folder…',
    export: 'Export',
    delete: 'Delete',
    deleteFile: 'Delete file',
    deleteFolder: 'Delete folder',
    create: 'Create',
    folderName: 'Folder name',
    cancel: 'Cancel',
    moveToRoot: 'Move to root',
    deleteFileConfirm: (name: string) => `Are you sure you want to delete “${name}”?`,
    deleteFolderConfirm: (name: string) =>
      `Are you sure you want to delete “${name}”? Its files will be moved to the root.`,
  },

  editor: {
    noFileSelected: 'No file selected',
    noFileHint: 'Pick a file from the sidebar, or press Ctrl+K to open Command.',
  },

  devOverlay: {
    ariaLabel: 'Keyboard bridge debug log',
    toggle: (open: boolean) => `${open ? 'Hide' : 'Show'} key bridge`,
    title: 'Key bridge log',
    clear: 'Clear',
    empty: 'No keys captured yet.',
  },

  settings: {
    back: 'Back',
    title: 'Settings',
    ariaLabel: 'Settings',
    navCalculator: 'Calculator',
    navDataSync: 'Data & Sync',
    navHelp: 'Help & Feedback',
    navAbout: 'About',
    sectionHelp: 'Help & feedback',
    groupMath: 'Math',
    groupEditor: 'Editor',
    groupEncryption: 'Encryption',
    groupWebdav: 'WebDAV sync',
    groupRates: 'Exchange rates',
    resultPrecision: 'Result precision',
    limitDecimals: 'Limit displayed decimals in results',
    precisionDigits: 'Precision digits',
    region: 'Region',
    systemDefault: 'System default',
    englishUS: 'English (United States)',
    chineseSimplified: 'Chinese (Simplified)',
    showGrouping: 'Show grouping separators',
    showGroupingHint: 'Format numbers like 12,345.58',
    fontSize: 'Font size',
    editorTextSize: 'Editor text size',
    showLineNumbers: 'Show line numbers',
    showLineNumbersHint: 'Display line numbers in the editor',
    encrypted: 'Encrypted',
    notSetUp: 'Not set up',
    checking: 'Checking…',
    endToEnd: 'End-to-end encryption',
    endToEndHint: 'Files are encrypted on this device before they sync.',
    setUpEncryption: 'Set up encryption',
    restoreFromMnemonic: 'Restore from mnemonic',
    recoveryOnly:
      'Your recovery phrase is the only way to restore encrypted files on a new device.',
    resetWarning:
      'This permanently removes encryption. Encrypted files become unreadable until you restore your mnemonic.',
    cancel: 'Cancel',
    confirmReset: 'Confirm reset',
    resetEncryption: 'Reset encryption',
    credentialsLocal: 'Credentials are stored only on this device.',
    url: 'URL',
    urlPlaceholder: 'https://dav.example.com/remote.php/dav',
    folderPath: 'Folder path',
    folderPlaceholder: 'numera',
    username: 'Username',
    password: 'Password',
    testing: 'Testing…',
    testConnection: 'Test connection',
    connected: 'Connected',
    corsHint:
      "A network or fetch error usually means the server hasn't enabled CORS (including the ETag header).",
    syncing: 'Syncing…',
    syncNow: 'Sync now',
    syncUploaded: 'Uploaded',
    syncDownloaded: 'Downloaded',
    syncConflicts: 'Conflicts',
    syncDeleted: 'Deleted',
    reviewConflicts: 'Review conflict copies — saved as .conflict.numr files.',
    setWebdavUrl: 'Set a WebDAV URL above to sync.',
    syncDescription: 'Sync this device with the WebDAV server.',
    ratesNote:
      'Rates come from open.er-api.com and are fetched only when you tap Refresh. Currency results otherwise use cached or built-in rates.',
    fetchingRates: 'Fetching latest rates…',
    usingDefaultRates: 'Using built-in default rates.',
    networkUnavailable: 'Network unavailable — using the last cached rates.',
    lastRefreshedNever: 'Last refreshed: never',
    lastRefreshed: (when: string, stale: boolean) =>
      `Last refreshed: ${when}${stale ? ' (stale)' : ''}`,
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    refreshRates: 'Refresh rates',
    sendFeedback: 'Send feedback',
    feedbackHint: 'Share ideas or report an issue. A feedback entry point is coming soon.',
    aboutTitle: 'Numera',
    version: 'Version',
    privacy: 'Privacy',
    license: 'License',
    sourceCode: 'Source Code',
  },

  encryption: {
    close: 'Close',
    headingSetUp: 'Encryption is set up',
    headingRestored: 'Encryption restored',
    headingRestore: 'Restore from recovery phrase',
    headingEndToEnd: 'End-to-end encryption',
    headingSave: 'Save your recovery phrase',
    headingConfirm: 'Confirm your recovery phrase',
    explain1:
      "Encryption is optional. When it's on, each file is encrypted on this device before it's uploaded, so the server never sees the plaintext.",
    explain2:
      "You'll be given a 12-word recovery phrase. Write it down and keep it safe — if you lose it, there is no way to recover your encrypted files.",
    generating: 'Creating your encryption key…',
    showBody:
      "Write down these 12 words, in order. This is the only way to restore your encrypted files on a new device. It won't be shown again.",
    copy: 'Copy',
    copied: 'Copied',
    savedPhrase: 'I have saved my recovery phrase',
    confirmBody: 'Enter the requested words to confirm you saved the phrase.',
    word: (index: number) => `Word ${index}`,
    doesntMatch: "Doesn't match",
    restoreBody:
      'Paste your 12-word recovery phrase to restore your encryption key on this device.',
    recoveryPhrase: 'Recovery phrase',
    doneSetup:
      'Your files will be encrypted on this device before they sync. Keep your recovery phrase safe.',
    doneRestore:
      'Your encryption key is restored. Encrypted files can now be opened on this device.',
    done: 'Done',
    cancel: 'Cancel',
    restoring: 'Restoring…',
    restore: 'Restore',
    continue: 'Continue',
    back: 'Back',
    finishing: 'Finishing…',
    finish: 'Finish',
  },
} as const;
