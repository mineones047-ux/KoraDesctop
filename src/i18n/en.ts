export interface Translations {
  app: { name: string; tagline: string; hint: string }
  sidebar: { newChat: string; search: string; noResults: string; noChats: string; result: string; results: string; systemMonitor: string; settings: string; agent: string; graph: string; chatView: string; renameChat: string; deleteChat: string }
  graph: {
    notes: string; loading: string; pickVault: string; retry: string; empty: string
    close: string; sendToChat: string; readError: string; truncated: string
    zoomIn: string; zoomOut: string; fitView: string
  }
  chat: { placeholder: string; send: string }
  inputBar: {
    commands: string; navigate: string; select: string; close: string
    volume: string
    stopSpeaking: string; readLast: string
    startRecording: string; stopRecording: string
    stopGenerating: string
  }
  message: { stop: string; readAloud: string }
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
    tabs: { customize: string; provider: string; prompt: string; voice: string; mcp: string }
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
    voiceDesc: string; previewVoice: string
    sttEngine: string; sttWebSpeech: string; sttWhisper: string; whisperHint: string
    modelDesc: string; apiKeyDesc: string
    decisionModel: string; decisionSameProvider: string
    decisionModelPlaceholder: string; decisionHint: string
    urlDesc: string
    vaultPath: string; vaultPathDesc: string; pickFolder: string
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
    tagline: 'Your AI assistant. Ask me anything.',
    hint: 'Type ! for commands',
  },
  sidebar: {
    newChat: 'New Chat',
    search: 'Search chats...',
    noResults: 'No chats found',
    noChats: 'No chats yet',
    result: 'result',
    results: 'results',
    systemMonitor: 'System Monitor',
    settings: 'Settings',
    agent: 'Agent',
    chatView: 'Chat',
    graph: 'Knowledge Graph',
    renameChat: 'Rename chat',
    deleteChat: 'Delete chat',
  },
  graph: {
    notes: 'notes',
    loading: 'Scanning vault...',
    pickVault: 'Choose vault folder',
    retry: 'Retry',
    empty: 'No vault configured. Open Settings → Knowledge to set the Obsidian path.',
    close: 'Close',
    sendToChat: 'Send to chat as context',
    readError: 'Could not read this note',
    truncated: 'truncated, full text:',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit graph to screen',
  },
  chat: {
    placeholder: 'Type ! for commands...',
    send: 'Send',
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
  },
  message: {
    stop: 'Stop',
    readAloud: 'Read aloud',
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
    modelDesc: 'The model to use for this provider',
    apiKeyDesc: 'Required for cloud providers. Stored locally on your PC.',
    urlDesc: 'Server address. Leave default if you use the official service',
    vaultPath: 'Obsidian vault',
    vaultPathDesc: 'Path to your Obsidian vault. Used by the Knowledge Graph to build the note map.',
    pickFolder: 'Choose folder',
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