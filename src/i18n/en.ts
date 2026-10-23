export interface Translations {
  app: { name: string }
  titleBar: { minimize: string; maximize: string; close: string }
  sidebar: { newChat: string; search: string; noResults: string; noChats: string; result: string; resultFew: string; results: string; systemMonitor: string; settings: string; agent: string; graph: string; chatView: string; renameChat: string; deleteChat: string; pin: string; unpin: string; pinned: string; today: string; yesterday: string; week: string; older: string }
  graph: {
    notes: string; noteOne: string; noteFew: string; loading: string; pickVault: string; retry: string; empty: string
    close: string; sendToChat: string; readError: string; truncated: string
    zoomIn: string; zoomOut: string; fitView: string
  }
  chat: {
    placeholder: string; send: string
    untitled: string; private: string; privateHint: string; you: string
    export: string; exported: string
    pin: string; unpin: string
    regenerate: string; edit: string; save: string; cancel: string
  }
  inputBar: {
    commands: string; navigate: string; select: string; close: string
    volume: string
    stopSpeaking: string; readLast: string
    startRecording: string; stopRecording: string
    stopGenerating: string
    tokens: string; shortcuts: string
  }
  message: {
    stop: string
    readAloud: string
    copy: string
    copied: string
    copyCode: string
    codeCopied: string
    edit: string
    regenerate: string
    save: string
    cancel: string
  }
  promptLib: {
    title: string; desc: string; add: string; namePlaceholder: string; textPlaceholder: string
    save: string; empty: string; delete: string; use: string; suggestTitle: string
    explainTitle: string; explainPrompt: string
    summarizeTitle: string; summarizePrompt: string
    translateTitle: string; translatePrompt: string
    brainstormTitle: string; brainstormPrompt: string
  }
  palette: {
    title: string; placeholder: string; actions: string; chats: string; prompts: string
    newChat: string; newPrivateChat: string; settings: string; system: string; agent: string
    graph: string; export: string; pin: string; unpin: string; regenerate: string
    empty: string; noResults: string; close: string
  }
  settings: {
    title: string; provider: string; lmstudioUrl: string; model: string
    noModels: string; refresh: string; apiKey: string; baseUrl: string
    enterModel: string; modelPlaceholder: string; savedProviders: string
    remove: string; providerName: string; add: string
    promptTemplate: string; custom: string
    temperature: string; precise: string; balanced: string; creative: string
    voice: string
    testConnection: string; testing: string
    connectionSuccess: string; connectionError: string
    language: string; languageDesc: string
    tabs: { customize: string; provider: string; prompt: string; voice: string; mcp: string; local: string; prompts: string }
    theme: string; themeDesc: string; themeDark: string; themeRed: string
    themeDarkDesc: string; themeRedDesc: string; themeLight: string; themeLightDesc: string
    themeRetro: string; themeRetroDesc: string
    graphColorDesc: string; graphColorTheme: string
    graphLinkColor: string; graphNodeColor: string
    local: string; cloud: string
    providerDesc: string; providerSetup: string
    promptDesc: string; promptTemplateDesc: string
    responseStyle: string; responseStyleDesc: string
    styleConcise: string; styleBalanced: string; styleDetailed: string
    voiceDesc: string; previewVoice: string; loadingVoices: string
    sttEngine: string; sttWebSpeech: string; sttWhisper: string; whisperHint: string
    modelDesc: string; apiKeyDesc: string
    decisionModel: string; decisionSameProvider: string
    decisionModelPlaceholder: string; decisionHint: string
    urlDesc: string
    vaultPath: string; vaultPathDesc: string; pickFolder: string
    behaviorTitle: string; approvalModeLabel: string; approvalModeDesc: string
    approvalAsk: string; approvalReadonly: string; approvalFull: string
    autoLaunchLabel: string; autoLaunchDesc: string
  }
  danger: {
    title: string; hint: string
    shell: string; file: string; delete: string; write: string
    rename: string; mkdir: string; open: string; shutdown: string; restart: string
  }
  mcp: {
    title: string; description: string; refresh: string; add: string; empty: string
    required: string
    statusOn: string; statusErr: string; statusOff: string
    toolsOne: string; toolsFew: string; tools: string
    stopped: string; enabled: string
    stop: string; restart: string; start: string; edit: string; remove: string
    removeConfirm: string
    hideTools: string; showTools: string
    editTitle: string; addTitle: string
    labelName: string; labelCommand: string; labelArgs: string; labelCwd: string
    labelEnv: string; labelDesc: string; labelTimeout: string
    autoStart: string; cancel: string; save: string
    errLoad: string; errListTools: string; errSave: string; errStart: string
    errStop: string; errRestart: string; errRemove: string; errToggle: string
  }
  localAI: {
    title: string; desc: string
    yourPc: string; recommendation: string; gpuVram: string
    searchPlaceholder: string; search: string; searching: string
    searchTitle: string
    noResults: string; searchError: string; filesError: string
    recommended: string; fits: string; downloads: string; files: string
    download: string; cancel: string; delete: string; deleteSure: string
    pause: string; resume: string; resumeHint: string
    noModels: string; modelsTitle: string
    categoryText: string; categoryAudio: string
    notFits: string
    audioTitle: string; audioDesc: string; audioTtsNote: string
    whisperBinaryNote: string; audioUse: string; audioActive: string
    engineGpu: string; engineGpuHint: string; engineCtx: string
    autoStartChat: string; autoStartStt: string
    diskTitle: string; diskDesc: string; diskScan: string; diskSearching: string
    diskNone: string; diskUse: string
    start: string; stop: string; starting: string; running: string; externalServer: string
    engineTitle: string; engineDesc: string; engineInstall: string
    engineInstalling: string; engineReady: string; engineMissing: string
    engineMissingErr: string; modelLoaded: string; serverStopped: string
    serverExited: string
  }
  system: {
    title: string; overview: string; processes: string
    hostname: string; platform: string; cpu: string; unknown: string
    cores: string; user: string; memory: string; uptime: string
    name: string; pid: string; mem: string; action: string; kill: string
  }
  commands: {
    shell: string; file: string; open: string; dir: string; write: string
    rename: string; delete: string; mkdir: string; stat: string
    exists: string; calc: string; random: string; uuid: string; time: string
    shutdown: string; restart: string; sleep: string; lock: string
    volume: string; mute: string; brightness: string; windows: string
    find: string; clipboard: string; confirm: string; deny: string; search: string
    help: string
  }
  help: {
    title: string; shell: string; file: string; open: string; dir: string
    write: string; rename: string; delete: string; mkdir: string
    stat: string; exists: string; helpCmd: string; typeHint: string
  }
  emptyChat: { title: string; subtitle: string; commandHint: string }
  agent: {
    title: string; thinking: string; acting: string
    confirmationRequired: string; approved: string; denied: string
    noToolsAvailable: string; waitingForInput: string
    startAgent: string; stopAgent: string; running: string
    inputPlaceholder: string; result: string; errorTitle: string
  }
}

export type T = Translations

const en: Translations = {
  app: {
    name: 'Kora',
  },
  titleBar: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
  },
  sidebar: {
    newChat: 'New Chat',
    search: 'Search chats...',
    noResults: 'No chats found',
    noChats: 'No chats yet',
    result: 'result',
    resultFew: 'results',
    results: 'results',
    systemMonitor: 'System Monitor',
    settings: 'Settings',
    agent: 'Agent',
    chatView: 'Chat',
    graph: 'Knowledge Graph',
    renameChat: 'Rename chat',
    deleteChat: 'Delete chat',
    pin: 'Pin chat',
    unpin: 'Unpin chat',
    pinned: 'Pinned',
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'Previous 7 days',
    older: 'Older',
  },
  graph: {
    notes: 'notes',
    noteOne: 'note',
    noteFew: 'notes',
    loading: 'Scanning vault...',
    pickVault: 'Choose vault folder',
    retry: 'Retry',
    empty: 'No vault configured. Open Settings → Customize to set the Obsidian path.',
    close: 'Close',
    sendToChat: 'Send to chat as context',
    readError: 'Could not read this note',
    truncated: 'truncated, full text:',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit graph to screen',
  },
  chat: {
    placeholder: 'Ask anything, or type ! for commands...',
    send: 'Send',
    untitled: 'New chat',
    private: 'Private',
    privateHint: 'This chat is not saved to disk',
    you: 'You',
    export: 'Export as Markdown',
    exported: 'Saved!',
    pin: 'Pin chat',
    unpin: 'Unpin chat',
    regenerate: 'Regenerate',
    edit: 'Edit message',
    save: 'Save',
    cancel: 'Cancel',
  },
  inputBar: {
    commands: 'Commands',
    navigate: '↑↓ navigate',
    select: 'Tab select',
    close: 'Esc close',
    volume: 'Volume',
    stopSpeaking: 'Stop speaking',
    readLast: 'Read last response',
    startRecording: 'Start voice input',
    stopRecording: 'Stop recording',
    stopGenerating: 'Stop generating',
    tokens: '~{count} tokens',
    shortcuts: 'Ctrl+K commands · Enter send · Shift+Enter new line',
  },
  message: {
    stop: 'Stop',
    readAloud: 'Read aloud',
    copy: 'Copy message',
    copied: 'Copied',
    copyCode: 'Copy code',
    codeCopied: 'Code copied',
    edit: 'Edit message',
    regenerate: 'Regenerate reply',
    save: 'Save and resend',
    cancel: 'Cancel',
  },
  promptLib: {
    title: 'Prompt library',
    desc: 'Save the instructions you retype often. They appear in a new chat and in the command palette.',
    add: 'Add prompt',
    namePlaceholder: 'Title, e.g. Code review',
    textPlaceholder: 'The full prompt text...',
    save: 'Save prompt',
    empty: 'No saved prompts yet. Add one below — or use a suggestion in a new chat.',
    delete: 'Delete prompt',
    use: 'Use prompt',
    suggestTitle: 'Try one of these',
    explainTitle: 'Explain this',
    explainPrompt: 'Explain this step by step, then point out the risky parts:\n\n',
    summarizeTitle: 'Summarize',
    summarizePrompt: 'Summarize the following text in five bullet points:\n\n',
    translateTitle: 'Translate',
    translatePrompt: 'Translate the following text into English, keeping its tone:\n\n',
    brainstormTitle: 'Brainstorm',
    brainstormPrompt: 'Give me five concrete ideas about: ',
  },
  palette: {
    title: 'Command palette',
    placeholder: 'Search chats, actions and prompts...',
    actions: 'Actions',
    chats: 'Chats',
    prompts: 'Prompts',
    newChat: 'New chat',
    newPrivateChat: 'New private chat',
    settings: 'Open settings',
    system: 'System monitor',
    agent: 'Agent mode',
    graph: 'Knowledge graph',
    export: 'Export current chat as Markdown',
    pin: 'Pin current chat',
    unpin: 'Unpin current chat',
    regenerate: 'Regenerate last reply',
    empty: 'Nothing matches that search',
    noResults: 'No results',
    close: 'Close',
  },
  settings: {
    title: 'Settings',
    provider: 'Provider',
    lmstudioUrl: 'LM Studio URL',
    model: 'Model',
    noModels: 'No models found',
    refresh: 'Refresh',
    apiKey: 'API Key',
    baseUrl: 'Base URL',
    enterModel: 'Enter model name',
    modelPlaceholder: 'Model name (e.g. gpt-3.5-turbo)',
    savedProviders: 'Saved Custom Providers',
    remove: 'Remove',
    providerName: 'Provider name',
    add: 'Add',
    promptTemplate: 'Prompt Template',
    custom: 'Custom',
    temperature: 'Temperature',
    precise: 'Precise (0)',
    balanced: 'Balanced (1)',
    creative: 'Creative (2)',
    decisionModel: 'Agent decision model (two-tier routing)',
    decisionSameProvider: 'Same as main provider',
    decisionModelPlaceholder: 'Small/fast model id (e.g. qwen2.5-7b)',
    decisionHint:
      'The small model picks tools during agent runs; the main model writes the final answer. Leave empty to use one model for both.',
    voice: 'Voice (Text-to-Speech)',
    testConnection: 'Test Connection',
    testing: 'Testing...',
    connectionSuccess: 'Connection successful!',
    connectionError: 'Error:',
    sttEngine: 'Voice input engine',
    sttWebSpeech: 'System (Web Speech API)',
    sttWhisper: 'Local (whisper.cpp)',
    whisperHint:
      'whisper.cpp transcribes offline: point to whisper-cli(.exe) and a ggml model (e.g. ggml-base.bin) from github.com/ggerganov/whisper.cpp. The system engine may be unavailable in some webviews — local mode always works.',
    language: 'Language',
    languageDesc: 'Choose the app interface language',
    tabs: {
      customize: 'Customize',
      provider: 'Provider',
      prompt: 'Prompt',
      voice: 'Voice',
      mcp: 'MCP Servers',
      local: 'Local AI',
      prompts: 'Prompts',
    },
    theme: 'Theme',
    themeDesc: 'Choose the look and feel of the app',
    themeDark: 'Dark',
    themeDarkDesc: 'Classic dark with a blue accent',
    themeRed: 'Crimson',
    themeRedDesc: 'Warm dark with a red accent',
    themeLight: 'Light',
    themeLightDesc: 'Clean bright theme with a red accent',
    themeRetro: 'Retro',
    themeRetroDesc: 'Pixel-style dark blue with hard shadows',
    graphColorDesc: 'Custom colors for the knowledge graph. Empty value follows the theme accent',
    graphColorTheme: 'Theme',
    graphLinkColor: 'Link color',
    graphNodeColor: 'Node color',
    local: 'Local',
    cloud: 'Cloud',
    providerDesc: 'Choose where your AI runs. Local providers run on this PC, cloud providers need an API key.',
    providerSetup: 'Provider settings',
    promptDesc: 'This prompt defines how the AI behaves, what it knows and how it answers you.',
    promptTemplateDesc: 'Start from a ready-made template, then fine-tune it below',
    responseStyle: 'Response style',
    responseStyleDesc: 'How detailed the AI replies should be',
    styleConcise: 'Concise',
    styleBalanced: 'Balanced',
    styleDetailed: 'Detailed',
    voiceDesc: 'Voice used to read AI responses aloud',
    previewVoice: 'Preview',
    loadingVoices: 'Loading voices…',
    modelDesc: 'The model to use for this provider',
    apiKeyDesc: 'Required for cloud providers. Stored locally on your PC.',
    urlDesc: 'Server address. Leave default if you use the official service',
    vaultPath: 'Obsidian vault',
    behaviorTitle: 'Behaviour',
    approvalModeLabel: 'Confirmation policy',
    approvalModeDesc: 'How the agent asks before it changes anything on this PC.',
    approvalAsk: 'Ask every time',
    approvalReadonly: 'Read-only',
    approvalFull: 'Allow everything',
    autoLaunchLabel: 'Start Kora with the system',
    autoLaunchDesc: 'Launch the app when you log in to Windows.',
    vaultPathDesc: 'Path to your Obsidian vault. Used by the Knowledge Graph to build the note map.',
    pickFolder: 'Choose folder',
  },
  danger: {
    title: 'Confirmation required',
    hint: 'Type `!confirm` to proceed or `!deny` to cancel.',
    shell: 'Run shell command: `{args}`',
    file: 'Read file: {args}',
    delete: 'Delete: {args}',
    write: 'Write to file: {args}',
    rename: 'Rename/move: {args}',
    mkdir: 'Create directory: {args}',
    open: 'Open: {args}',
    shutdown: 'Shut down the PC',
    restart: 'Restart the PC',
  },
  mcp: {
    title: 'MCP Servers',
    description:
      'Servers expose tools to the agent via stdio (JSON-RPC). Example: npx -y @modelcontextprotocol/server-filesystem <path>',
    refresh: 'Refresh',
    add: 'Add',
    empty: 'No MCP servers configured',
    required: 'Name and command are required',
    statusOn: 'ON',
    statusErr: 'ERR',
    statusOff: 'OFF',
    toolsOne: 'tool',
    toolsFew: 'tools',
    tools: 'tools',
    stopped: 'Stopped',
    enabled: 'Enabled',
    stop: 'Stop',
    restart: 'Restart',
    start: 'Start',
    edit: 'Edit',
    remove: 'Remove',
    removeConfirm: 'Remove "{name}"?',
    hideTools: 'Hide tools',
    showTools: 'Show tools',
    editTitle: 'Edit MCP server',
    addTitle: 'Add MCP server',
    labelName: 'Display name',
    labelCommand: 'Command',
    labelArgs: 'Args (space-separated, quote if needed)',
    labelCwd: 'Working dir (optional)',
    labelEnv: 'Environment (KEY=value, one per line)',
    labelDesc: 'Description (optional)',
    labelTimeout: 'Request timeout, ms (optional)',
    autoStart: 'Auto-start on app launch',
    cancel: 'Cancel',
    save: 'Save',
    errLoad: 'failed to load',
    errListTools: 'failed to list tools',
    errSave: 'save failed',
    errStart: 'start failed',
    errStop: 'stop failed',
    errRestart: 'restart failed',
    errRemove: 'remove failed',
    errToggle: 'toggle failed',
  },
  localAI: {
    title: 'Local models',
    desc: 'Download open models from Hugging Face and run them on this PC with llama.cpp.',
    yourPc: 'Your PC',
    recommendation: 'Up to {params}B parameters · {quant}',
    gpuVram: 'GPU: {vram} GB',
    searchPlaceholder: 'Search Hugging Face — e.g. Qwen 7B',
    search: 'Search',
    searching: 'Searching…',
    searchTitle: 'Find models',
    noResults: 'Nothing found for this query',
    searchError: 'Search failed: {error}',
    filesError: 'Could not list files: {error}',
    recommended: '★ For your PC',
    fits: 'Fits your PC',
    downloads: '{n} downloads',
    files: 'GGUF files',
    download: 'Download',
    cancel: 'Cancel',
    pause: 'Pause',
    resume: 'Resume',
    resumeHint: 'Continue the interrupted download from the byte it stopped at',
    delete: 'Delete',
    deleteSure: 'Really delete?',
    noModels: 'No models downloaded yet — search above',
    modelsTitle: 'Downloaded models',
    start: 'Start',
    stop: 'Stop',
    starting: 'Starting server…',
    running: 'Running · port {port}',
    externalServer: 'Reusing an external llama-server · port {port}',
    engineTitle: 'llama.cpp engine',
    engineDesc: 'The runtime that plays GGUF models. Downloaded once, kept on this PC.',
    engineInstall: 'Download engine (~19 MB)',
    engineInstalling: 'Downloading engine…',
    engineReady: 'Engine installed',
    engineMissing: 'Engine not installed',
    engineMissingErr: 'The llama.cpp engine is not installed — download it first.',
    modelLoaded: 'Loaded {name} — provider switched to llama.cpp',
    categoryText: 'Text models (LLM)',
    categoryAudio: 'Audio (STT / TTS)',
    notFits: "Won't fit · needs {size} free",
    audioTitle: 'Speech recognition (STT)',
    audioDesc: 'whisper.cpp models for offline dictation. Bigger means more accurate; the fit check uses your RAM.',
    audioTtsNote: 'Text-to-speech needs no download: it already runs on the built-in TTS engine (Settings → Voice).',
    whisperBinaryNote: 'Dictation also needs the whisper.cpp binary path — set it in Settings → Voice.',
    audioUse: 'Download',
    audioActive: 'Active ✓',
    engineGpu: 'GPU layers',
    engineGpuHint: '0 = CPU only, empty = engine default',
    engineCtx: 'Context',
    autoStartChat: 'Load on app start',
    autoStartStt: 'Fetch on app start',
    diskTitle: 'Models already on this PC',
    diskDesc: 'Kora searches your drives for .gguf files and can serve one as is — no re-download.',
    diskScan: 'Scan drives',
    diskSearching: 'Scanning…',
    diskNone: 'No .gguf models found (depth 3, ~8 s budget).',
    diskUse: 'Serve',
    serverStopped: 'Server stopped',
    serverExited: 'Server exited unexpectedly (code {code})',
  },
  system: {
    title: 'System Monitor',
    overview: 'Overview',
    processes: 'Processes',
    hostname: 'Hostname',
    platform: 'Platform',
    cpu: 'CPU',
    unknown: 'Unknown',
    cores: 'cores',
    user: 'User',
    memory: 'Memory',
    uptime: 'Uptime',
    name: 'Name',
    pid: 'PID',
    mem: 'Memory',
    action: 'Action',
    kill: 'Kill',
  },
  commands: {
    shell: 'Run shell command',
    file: 'Read file contents',
    open: 'Open file or app',
    dir: 'List directory',
    write: 'Write text to file',
    rename: 'Rename/move file',
    delete: 'Delete file/folder',
    mkdir: 'Create directory',
    stat: 'File info',
    exists: 'Check if exists',
    calc: 'Calculate expression',
    random: 'Random number',
    uuid: 'Generate UUID',
    time: 'Current date/time',
    shutdown: 'Shut down PC',
    restart: 'Restart PC',
    sleep: 'Sleep PC',
    lock: 'Lock screen',
    volume: 'Set volume (0-100)',
    mute: 'Toggle mute',
    brightness: 'Set brightness (0-100)',
    windows: 'List open windows',
    find: 'Search files by pattern',
    clipboard: 'Read/write clipboard',
    confirm: 'Confirm dangerous action',
    deny: 'Deny dangerous action',
    search: 'Search the web',
    help: 'Show help',
  },
  help: {
    title: 'Available commands:',
    shell: 'Run a shell command',
    file: 'Read a file',
    open: 'Open a file or application',
    dir: 'List directory contents',
    write: 'Write text to a file',
    rename: 'Rename or move a file',
    delete: 'Delete a file or folder',
    mkdir: 'Create a directory',
    stat: 'Show file info (size, dates)',
    exists: 'Check if a path exists',
    helpCmd: 'Show this help',
    typeHint: 'Type `!` to see all commands in the popup menu.',
  },
  emptyChat: {
    title: 'Kora',
    subtitle: 'Your AI assistant. Ask me anything.',
    commandHint: 'Type `!help` for smart commands',
  },
  agent: {
    title: 'Agent Mode',
    thinking: 'Thinking...',
    acting: 'Acting...',
    confirmationRequired: 'Confirmation required',
    approved: 'Approved',
    denied: 'Denied',
    noToolsAvailable: 'No tools available',
    waitingForInput: 'Waiting for input',
    startAgent: 'Start Agent',
    stopAgent: 'Stop',
    running: 'Agent is running...',
    inputPlaceholder: 'Describe a task for the agent...',
    result: 'Result',
    errorTitle: 'Agent error',
  }
}

export default en
