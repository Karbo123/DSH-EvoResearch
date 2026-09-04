# 批量本地化：把 client 源码中的硬编码英文 UI 文案替换为 t('key')
# 每个替换对声明期望出现次数，不匹配即报错，防止误替换。
$ErrorActionPreference = 'Stop'
$root = 'D:\DSH-Research\packages\evoresearch-app\src\client'

function Apply([string]$name, [object[]]$pairs, [string]$doneMarker) {
  $path = Join-Path $root $name
  $content = [System.IO.File]::ReadAllText($path)
  if ($content.Contains("t('$doneMarker')")) { Write-Host "skip: $name"; return }
  foreach ($p in $pairs) {
    $old = $p[0]; $new = $p[1]; $expected = [int]$p[2]
    $count = ([regex]::Matches($content, [regex]::Escape($old))).Count
    if ($count -ne $expected) { throw "MISMATCH in $name : [$old] expected $expected got $count" }
    $content = $content.Replace($old, $new)
  }
  [System.IO.File]::WriteAllText($path, $content)
  Write-Host "done: $name"
}

$threadlist = @(
  @('title: ''Confirm delete — this cannot be undone''', 'title: t(''confirmDeleteTitle'')', 1),
  @('''aria-label'': ''Confirm delete''', '''aria-label'': t(''confirmDeleteTitle'')', 1),
  @('''Remove tag color'' : ''Set tag color''', 't(''removeTagColor'') : t(''setTagColor'')', 1),
  @('''Remove tag'' : ''Tag''', 't(''removeTag'') : t(''tag'')', 1),
  @('? ''Unpin'' : ''Pin''', '? t(''unpin'') : t(''pin'')', 2),
  @('placeholder: ''Rename session''', 'placeholder: t(''renameSession'')', 1),
  @('title: ''Save''', 'title: t(''save'')', 1),
  @('''aria-label'': ''Save''', '''aria-label'': t(''save'')', 1),
  @('title: ''Running''', 'title: t(''runningDot'')', 1),
  @('title: ''Tagged''', 'title: t(''tagged'')', 1),
  @('title: ''Pinned''', 'title: t(''pinned'')', 1),
  @('title: ''Tag color''', 'title: t(''tagColor'')', 1),
  @('''aria-label'': ''Tag color''', '''aria-label'': t(''tagColor'')', 1),
  @('title: ''Rename''', 'title: t(''rename'')', 1),
  @('''aria-label'': ''Rename''', '''aria-label'': t(''rename'')', 1),
  @('title: ''Side chat from this session''', 'title: t(''sideChatFromThis'')', 1),
  @('''aria-label'': ''Side chat''', '''aria-label'': t(''sideChatFromThis'')', 1),
  @('title: ''Export JSON''', 'title: t(''exportJson'')', 1),
  @('''aria-label'': ''Export JSON''', '''aria-label'': t(''exportJson'')', 1),
  @('title: ''Export Markdown''', 'title: t(''exportMarkdown'')', 1),
  @('''aria-label'': ''Export Markdown''', '''aria-label'': t(''exportMarkdown'')', 1),
  @('children: ''Delete?''', 'children: t(''deleteQ'')', 1),
  @('title: ''Delete session''', 'title: t(''deleteSession'')', 1),
  @('''aria-label'': ''Delete session''', '''aria-label'': t(''deleteSession'')', 1)
)
Apply 'threadlist.ts' $threadlist 'renameSession'

$chat = @(
  @('`Question（${questions.length}）` : ''Question''', '`${t(''question'')}（${questions.length}）` : t(''question'')', 1),
  @('title: ''Edit（回填输入框）''', 'title: t(''editMsg'')', 1),
  @('''aria-label'': ''Edit message''', '''aria-label'': t(''editMsg'')', 1),
  @('children: ''Thinking''', 'children: t(''thinking'')', 1),
  @('children: ''View cleared''', 'children: t(''viewCleared'')', 1),
  @('children: ''Restore view''', 'children: t(''restoreView'')', 1),
  @('children: ''running…''', 'children: t(''runningLower'')', 1),
  @('title: ''Dismiss''', 'title: t(''dismiss'')', 1),
  @('title: ''Clear workflow''', 'title: t(''clearWorkflow'')', 2),
  @('children: ''Tool approval required''', 'children: t(''toolApprovalRequired'')', 1),
  @('children: ''Approve''', 'children: t(''approve'')', 1),
  @('children: ''Reject''', 'children: t(''reject'')', 1),
  @('placeholder: ''Custom answer…''', 'placeholder: t(''customAnswer'')', 1),
  @('children: ''Submit''', 'children: t(''submit'')', 1),
  @('children: ''Cancel''', 'children: t(''cancel'')', 1),
  @('title: ''Remove attachment''', 'title: t(''removeAttachment'')', 1),
  @('''aria-label'': ''Remove attachment''', '''aria-label'': t(''removeAttachment'')', 1),
  @('title: ''Drag to resize''', 'title: t(''dragToResize'')', 1),
  @('''aria-label'': ''Markdown preview''', '''aria-label'': t(''markdownPreview'')', 1),
  @('title: ''Compact（摘要投影，不删历史）''', 'title: t(''compactTitle'')', 1),
  @('title: ''Current session''', 'title: t(''currentSession'')', 1),
  @('title: ''Search''', 'title: t(''search'')', 1),
  @('title: ''Keyboard shortcuts''', 'title: t(''shortcuts'')', 1),
  @('title: ''Compact''', 'title: t(''compact'')', 1),
  @('title: ''Clear queue''', 'title: t(''clearQueue'')', 1),
  @('title: ''Save''', 'title: t(''save'')', 1),
  @('title: ''Cancel''', 'title: t(''cancel'')', 1),
  @('title: ''Edit''', 'title: t(''edit'')', 1),
  @('title: ''Remove''', 'title: t(''remove'')', 1)
)
Apply 'chat.ts' $chat 'editMsg'

$inspector = @(
  @(': ''Agents''', ': t(''agents'')', 1),
  @('title: ''Close inspector''', 'title: t(''hideInspector'')', 1),
  @('children: ''Tree''', 'children: t(''tree'')', 1),
  @('children: ''By type''', 'children: t(''byType'')', 1),
  @('title: ''Confirm delete all side chats — cannot be undone''', 'title: t(''confirmDeleteAllTitle'')', 1),
  @('''aria-label'': ''Confirm delete all side chats''', '''aria-label'': t(''confirmDeleteAllTitle'')', 1),
  @('children: ''Delete all?''', 'children: t(''deleteAllQ'')', 1),
  @('title: ''Delete all side chats''', 'title: t(''deleteAllSideChats'')', 1),
  @('''aria-label'': ''Delete all side chats''', '''aria-label'': t(''deleteAllSideChats'')', 1),
  @('title: ''Confirm delete — this cannot be undone''', 'title: t(''confirmDeleteTitle'')', 1),
  @('''aria-label'': ''Confirm delete side chat''', '''aria-label'': t(''deleteSideChat'')', 1),
  @('children: ''Delete?''', 'children: t(''deleteQ'')', 1),
  @('title: ''Delete side chat''', 'title: t(''deleteSideChat'')', 1),
  @('''aria-label'': ''Delete side chat''', '''aria-label'': t(''deleteSideChat'')', 1),
  @('title: ''New side chat（继承当前会话历史）''', 'title: t(''newSideChatInherit'')', 1),
  @('children: ''Inherit''', 'children: t(''inherit'')', 1),
  @('title: ''New blank side chat（仅继承 workspace）''', 'title: t(''newSideChatBlank'')', 1),
  @('children: ''Blank''', 'children: t(''blank'')', 1),
  @('children: ''Loading…''', 'children: t(''loading'')', 1),
  @('children: ''running''', 'children: t(''runningDot'')', 1),
  @('title: ''Refresh''', 'title: t(''refresh'')', 3),
  @('title: ''Download''', 'title: t(''download'')', 1)
)
Apply 'inspector.ts' $inspector 'hideInspector'

$panels = @(
  @('children: ''Loading…''', 'children: t(''loading'')', 1),
  @('children: ''Projects''', 'children: t(''projects'')', 2),
  @('children: ''No projects yet''', 'children: t(''noProjectsYet'')', 2),
  @('children: ''Turn Catalog''', 'children: t(''turnCatalog'')', 1),
  @('children: ''turns''', 'children: t(''turns'')', 1),
  @('children: ''Goals''', 'children: t(''goals'')', 1),
  @('children: ''No active goals''', 'children: t(''noActiveGoals'')', 1),
  @('children: ''Overview''', 'children: t(''overview'')', 1),
  @('children: ''History''', 'children: t(''history'')', 1),
  @('children: ''Identity''', 'children: t(''identity'')', 1),
  @('children: ''Knowledge''', 'children: t(''knowledge'')', 1),
  @('children: ''No observations yet''', 'children: t(''noObservationsYet'')', 1),
  @('children: ''superseded''', 'children: t(''superseded'')', 1),
  @('children: ''No research turns yet''', 'children: t(''noResearchTurnsYet'')', 1),
  @('title: ''Open thread''', 'title: t(''openThread'')', 1),
  @('children: ''Load earlier''', 'children: t(''loadEarlier'')', 1),
  @('title: ''Scheduled''', 'title: t(''scheduled'')', 1),
  @('placeholder: ''Task name''', 'placeholder: t(''taskName'')', 1),
  @('placeholder: ''cron (5 fields)''', 'placeholder: t(''cronHint'')', 1),
  @('placeholder: ''Prompt (executed at cron time)''', 'placeholder: t(''promptHint'')', 1),
  @('children: ''Add''', 'children: t(''add'')', 1),
  @('children: ''No scheduled tasks''', 'children: t(''noScheduledTasks'')', 1),
  @('title: ''Next run''', 'title: t(''nextRun'')', 1),
  @('title: ''Open result thread''', 'title: t(''openResultThread'')', 1),
  @('title: ''Run now''', 'title: t(''runNow'')', 1),
  @('title: ''Report to main chat''', 'title: t(''reportToChat'')', 1),
  @('title: ''Remove''', 'title: t(''remove'')', 1),
  @('placeholder: ''Search skills…''', 'placeholder: t(''searchSkills'')', 1),
  @('children: ''No skills found''', 'children: t(''noSkillsFound'')', 1),
  @('children: ''When to use: ''', 'children: t(''whenToUse'')', 1),
  @('children: ''AutoSkills schedule''', 'children: t(''autoskillsSchedule'')', 1),
  @('children: ''Enabled''', 'children: t(''enabled'')', 1),
  @('children: ''Review''', 'children: t(''review'')', 1),
  @('children: ''Auto''', 'children: t(''auto'')', 1),
  @('children: ''No skill proposals yet''', 'children: t(''noSkillProposals'')', 1),
  @('children: ''Approve''', 'children: t(''approve'')', 1),
  @('children: ''Reject''', 'children: t(''reject'')', 1),
  @('children: ''Run''', 'children: t(''run'')', 1),
  @('title: ''Research Skills''', 'title: t(''researchSkills'')', 1),
  @('children: ''Proposals''', 'children: t(''proposals'')', 1),
  @('children: ''Marketplace''', 'children: t(''marketplace'')', 1),
  @('title: ''Workspace''', 'title: t(''workspace'')', 1),
  @('placeholder: ''Project source path (folder)''', 'placeholder: t(''projectPathHint'')', 1),
  @('placeholder: ''Project name (optional)''', 'placeholder: t(''projectNameHint'')', 1),
  @('children: ''Import''', 'children: t(''importProject'')', 1),
  @('title: ''Refresh''', 'title: t(''refresh'')', 3),
  @('title: ''Channels''', 'title: t(''channels'')', 1),
  @('children: ''Messaging channels''', 'children: t(''messagingChannels'')', 1),
  @('children: ''No messaging channels are available''', 'children: t(''noChannels'')', 1),
  @('title: ''Team''', 'title: t(''team'')', 1),
  @('children: ''Research experts''', 'children: t(''researchExperts'')', 1),
  @('children: ''Clear''', 'children: t(''clear'')', 1),
  @('children: ''invited''', 'children: t(''invited'')', 1),
  @('children: ''Invite''', 'children: t(''invite'')', 1)
)
Apply 'panels.ts' $panels 'projects'

$wfiles = @(
  @('title: ''Back''', 'title: t(''back'')', 1),
  @('children: ''Loading…''', 'children: t(''loading'')', 2),
  @('children: ''No active workspace''', 'children: t(''noActiveWorkspace'')', 1),
  @('title: ''Refresh''', 'title: t(''refresh'')', 1),
  @('title: ''Upload folder''', 'title: t(''uploadFolder'')', 1)
)
Apply 'workspace-files.ts' $wfiles 'back'

$settings = @(
  @('label: ''Read-only''', 'label: t(''readOnly'')', 1),
  @('label: ''Write''', 'label: t(''permWrite'')', 1),
  @('label: ''Full effect''', 'label: t(''fullEffect'')', 1),
  @('children: ''Permission''', 'children: t(''permission'')', 1),
  @('children: ''Plugins''', 'children: t(''plugins'')', 1),
  @('children: ''Loading…''', 'children: t(''loading'')', 1)
)
Apply 'settings.ts' $settings 'readOnly'

$sess = @(
  @('label: ''Thread ID''', 'label: t(''threadId'')', 1),
  @('label: ''Workspace''', 'label: t(''workspace'')', 1),
  @('label: ''Model / Provider''', 'label: t(''modelProvider'')', 1),
  @('label: ''Permission''', 'label: t(''permission'')', 1),
  @('label: ''Tokens · Context''', 'label: t(''tokensContext'')', 1),
  @('label: ''Input · Output''', 'label: t(''inputOutput'')', 1),
  @('label: ''Active Experts''', 'label: t(''activeExperts'')', 1),
  @('? ''none'' :', '? t(''none'') :', 1),
  @('label: ''Session events''', 'label: t(''sessionEvents'')', 1),
  @('label: ''Session file''', 'label: t(''sessionFile'')', 1),
  @('title: ''Clear view 仅清空当前展示，不删除数据；刷新即可恢复''', 'title: t(''clearViewTitle'')', 1),
  @('children: ''Clear view''', 'children: t(''clearView'')', 1),
  @('title: ''Current session''', 'title: t(''currentSession'')', 1),
  @('title: ''Search''', 'title: t(''search'')', 1),
  @('placeholder: ''Search current view…''', 'placeholder: t(''searchCurrentView'')', 1),
  @('children: ''No matches in full history''', 'children: t(''noMatches'')', 1),
  @('title: ''Keyboard shortcuts''', 'title: t(''shortcuts'')', 1),
  @('title: ''Select model''', 'title: t(''selectModel'')', 1),
  @('children: ''Loading…''', 'children: t(''loading'')', 1),
  @('children: ''No models available''', 'children: t(''noModels'')', 1),
  @('children: ''Cancel''', 'children: t(''cancel'')', 1),
  @('title: ''Close''', 'title: t(''close'')', 1),
  @('''aria-label'': ''Close''', '''aria-label'': t(''close'')', 1)
)
Apply 'session-actions.ts' $sess 'threadId'

$index = @(
  @('children: ''Reload''', 'children: t(''reload'')', 1),
  @('children: ''Go back''', 'children: t(''goBack'')', 1)
)
Apply 'index.ts' $index 'reload'

Write-Host 'ALL OK'

