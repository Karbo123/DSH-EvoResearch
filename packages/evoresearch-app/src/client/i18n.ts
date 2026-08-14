/**
 * 工作台 i18n（中/英）。默认英文；语言偏好存 localStorage
 * （键 evoresearch-lang），切换后刷新页面生效（与主题切换同模式）。
 */

const KEY = 'evoresearch-lang'

export type Lang = 'en' | 'zh'

export function readLang(): Lang {
  if (typeof localStorage === 'undefined') return 'en'
  return localStorage.getItem(KEY) === 'zh' ? 'zh' : 'en'
}

export function setLang(lang: Lang): void {
  localStorage.setItem(KEY, lang)
}

const DICT: Record<string, [string, string]> = {
  // 顶栏 / 标题栏
  hideNavigation: ['Hide navigation', '收起导航'],
  showNavigation: ['Show navigation', '展开导航'],
  newChat: ['New chat', '新建对话'],
  sideChats: ['Side chats', '侧边对话'],
  switchToLight: ['Switch to light mode', '切换到浅色模式'],
  switchToDark: ['Switch to dark mode', '切换到深色模式'],
  showWorkspace: ['Show workspace', '打开工作区'],
  hideInspector: ['Hide inspector', '收起检查器'],
  settings: ['Settings', '设置'],
  connected: ['Connected', '已连接'],
  offline: ['Offline', '离线'],
  home: ['Home', '首页'],
  // 左侧栏
  importProject: ['Import Project', '导入项目'],
  researchSkills: ['Research Skills', '科研技能'],
  evomemory: ['EvoMemory', '科研记忆'],
  scheduled: ['Scheduled', '定时任务'],
  searchResearch: ['Search research...', '搜索科研记录...'],
  recents: ['Recents', '最近'],
  noResearchYet: ['No research yet', '暂无科研记录'],
  noMatchingResearch: ['No matching research', '无匹配记录'],
  // 欢迎页 / 输入面板
  welcome: ['Where research evolves', '科研在此进化'],
  tagline: ['Your self-evolving lab partner — reads the literature, runs experiments, and remembers what matters.', '你的自进化科研伙伴——阅读文献、运行实验、记住真正重要的东西。'],
  askAnything: ['Ask EvoResearch anything...', '向 EvoResearch 提问...'],
  noActiveConversation: ['No active conversation', '暂无活跃对话'],
  running: ['Running…', '运行中…'],
  autoApprove: ['Auto-approve', '自动批准'],
  send: ['Send', '发送'],
  attachFiles: ['Attach files', '添加附件'],
  // 检查器
  workspace: ['Workspace', '工作区'],
  agents: ['Agents', '智能体'],
  noFilesYet: ['No files in the workspace yet', '工作区暂无文件'],
  noActiveAgents: ['No active agents', '暂无活跃智能体'],
  noSideChats: ['No side chats yet', '暂无侧边对话'],
  // 设置
  theme: ['Theme', '主题'],
  language: ['Language', '语言'],
  model: ['Model', '模型'],
  about: ['About', '关于'],
  light: ['Light', '浅色'],
  dark: ['Dark', '深色'],
  system: ['System', '跟随系统'],
  close: ['Close', '关闭'],
  version: ['Version', '版本'],
  basedOn: ['Based on deepseek-harness 0.1.0-rc.6', '基于 deepseek-harness 0.1.0-rc.6'],
  noSession: ['Open a conversation to choose a model', '打开会话后可选择模型'],
  current: ['Current', '当前'],
}

export function t(key: string): string {
  const pair = DICT[key]
  if (pair === undefined) return key
  return readLang() === 'zh' ? pair[1] : pair[0]
}
