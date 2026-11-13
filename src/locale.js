/**
 * Host-side text for coach notices, `/squeeze` output, guard reasons, and
 * exports. The Web panel has its own Client locale dictionaries; the Host has
 * no readable UI-locale service, so `config.locale` (or the process locale)
 * decides these strings. See docs/compat-notes.md D-2.
 * @module dsh-pressure/locale
 */

const EN = {
  'signal.failure_streak': 'Consecutive tool failures',
  'signal.context_pressure': 'Context pressure',
  'signal.budget_pressure': 'Budget pressure',
  'signal.bloated_result': 'Large tool result',
  'signal.compaction_churn': 'Repeated compaction',
  'signal.repeat_calls': 'Repeated tool calls',
  'signal.budget_exhausted': 'Tool calls paused',

  'advice.inspectLastError': 'Inspect the last error before retrying; change the approach instead of repeating the call.',
  'advice.compactOrNarrow': 'Run /compact or narrow the task before reading more files.',
  'advice.convergeOrRaise': 'Summarize what is known and finish the step, or raise the budget with /squeeze budget.',
  'advice.narrowRead': 'Read a narrower range (offset/limit or grep) instead of the whole result.',
  'advice.avoidReReading': 'Check whether you are re-reading the same material after compaction.',
  'advice.changeApproach': 'Change the arguments or the approach instead of repeating the call.',
  'advice.toolsStopped': 'New tool calls are paused; answer with what you already have or raise the budget.',
  'advice.none': 'No actionable signal in this turn.',

  'notice.failureStreak': 'Pressure check (turn {turn}): {count} tool calls failed in a row. Inspect the last error before retrying; if the same failure repeats, stop and report. (dsh-pressure)',
  'notice.contextPressure': 'Pressure check: context is at {percent}% of the window. Prefer /compact or a narrower task before reading more files. (dsh-pressure)',
  'notice.budgetPressure': 'Pressure check: {percent}% of the {dimension} budget is used ({spent} / {limit}). Start converging: summarize what is known and finish the current step. (dsh-pressure)',
  'notice.bloatedResult': 'Pressure check: the last tool result is about {tokens} tokens. Read a narrower range instead of the whole result. (dsh-pressure)',
  'notice.compactionChurn': 'Pressure check: context was compacted {count} times this turn. Check whether you are re-reading material that was just compacted away. (dsh-pressure)',

  'denial.dimension.sessionTokens': 'session token',
  'denial.dimension.turnTokens': 'turn token',
  'denial.dimension.turnToolCalls': 'turn tool-call',
  'denial.budget': 'dsh-pressure: the {dimension} budget is reached ({spent} / {limit}), so new tool calls are paused so this turn can converge. You can still produce a final answer from the information already gathered. Raise the budget with /squeeze budget, or switch the session to observe with /squeeze mode observe. This is a tool brake, not a zero-overspend guarantee: the final answer is still billed.',

  'command.usage': [
    'Usage:',
    '  /squeeze status',
    '  /squeeze report [turn]',
    '  /squeeze mode observe|coach|enforce',
    '  /squeeze budget session <tokens> | turn <tokens> | tools <n>   (0 = unlimited)',
    '  /squeeze flags',
    '  /squeeze mute <code> | unmute <code>',
    '  /squeeze purge --yes',
  ].join('\n'),
  'command.noBinding': 'This session is not active in dsh-pressure yet. Send one message, then retry.',
  'command.status': 'mode={mode} · session {sessionSpent}/{sessionLimit} tok · turn {turnSpent}/{turnLimit} tok · tools {turnCalls}/{toolLimit} · flags {flags} · receipts {receipts}',
  'command.limitNone': 'none',
  'command.modeSet': 'Session mode is now {mode}.',
  'command.invalidMode': 'Unknown mode "{value}". Use observe, coach, or enforce.',
  'command.invalidNumber': '"{value}" is not a non-negative integer.',
  'command.budgetSet': '{dimension} budget is now {value} (0 = unlimited).',
  'command.reportEmpty': 'No receipt for {target} yet.',
  'command.reportTitle': 'Receipt · {target}',
  'command.reportLine': 'tokens {total} · cache hit {cache} · tools {calls}/{failures} failed · signals {signals}',
  'command.flagsEmpty': 'No signals this turn.',
  'command.flagsLine': '{code} ×{count} ({severity}) — {advice}',
  'command.muted': '{code} is muted for this session. Receipts still record it.',
  'command.unmuted': '{code} is unmuted for this session.',
  'command.unknownCode': 'Unknown signal code "{code}".',
  'command.purged': 'Removed {n} receipt(s) for this session.',
  'command.purgeNeedsYes': 'This deletes this session’s receipts. Re-run /squeeze purge --yes to confirm.',
  'command.purgeAllNotSupported': 'Purging every session is not supported in v0.1; run it per session.',

  'export.title': 'DSH Pressure receipt',
  'export.generatedAt': 'Generated {time} by dsh-pressure {version}',
  'export.scopeNote': 'Token figures are runtime volume (uncached input + output + cache read/write), not billed amounts.',
  'export.cacheFormula': 'Cache hit rate = cacheRead / (cacheRead + input + cacheWrite); unknown when the denominator is zero.',
  'export.noBody': 'Contains no prompt text, tool arguments, tool results, or keys.',
  'export.none': 'none',
  'export.unknown': 'unknown',
  'export.turn': 'Turn',
  'export.started': 'Started',
  'export.ended': 'Ended',
  'export.wall': 'Wall time',
  'export.tokens': 'Tokens',
  'export.cacheHit': 'Cache hit rate',
  'export.context': 'Context pressure',
  'export.tools': 'Tools',
  'export.budget': 'Budget',
  'export.signals': 'Signals',
  'export.advice': 'Next step',
  'export.partial': 'partial data',
  'export.turnLine': 'turn {turn} · {total} tok · {calls} tools · {failures} failed · {signals} signals',
  'export.csvHeader': 'sessionId,turn,startedAt,endedAt,wallMs,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,cacheHitRate,endPressure,observedPeak,observedFrom,toolCalls,toolFailures,toolRepeats,compactions,mode,sessionLimit,sessionSpent,overBudget,denied,flags,adviceKey,partial',
}

const ZH = {
  'signal.failure_streak': '工具连续失败',
  'signal.context_pressure': '上下文压力',
  'signal.budget_pressure': '预算压力',
  'signal.bloated_result': '工具结果过大',
  'signal.compaction_churn': '重复压缩',
  'signal.repeat_calls': '重复工具调用',
  'signal.budget_exhausted': '工具调用已暂停',

  'advice.inspectLastError': '先看最后一次错误，改变做法，不要原样重试。',
  'advice.compactOrNarrow': '先执行 /compact，或缩小任务范围，再继续读文件。',
  'advice.convergeOrRaise': '先总结已知信息并收尾，或用 /squeeze budget 提高预算。',
  'advice.narrowRead': '用 offset/limit 或 grep 读取更小的范围，不要整份读取。',
  'advice.avoidReReading': '检查是否在压缩后又重复读取同一批内容。',
  'advice.changeApproach': '换参数或换做法，不要重复同一次调用。',
  'advice.toolsStopped': '新的工具调用已暂停；用已有信息回答，或提高预算。',
  'advice.none': '本轮没有可执行的信号。',

  'notice.failureStreak': '压力提醒（第 {turn} 轮）：连续 {count} 次工具调用失败。先看最后一次错误，不要原样重试；若重复失败，先停下来汇报。 (dsh-pressure)',
  'notice.contextPressure': '压力提醒：上下文已占窗口 {percent}%。建议先 /compact 或缩小任务，再继续读文件。 (dsh-pressure)',
  'notice.budgetPressure': '压力提醒：{dimension}预算已用 {percent}%（{spent} / {limit}）。开始收尾：总结已知信息，完成当前步骤。 (dsh-pressure)',
  'notice.bloatedResult': '压力提醒：上一次工具结果约 {tokens} tokens。请改读更小的范围，不要整份读取。 (dsh-pressure)',
  'notice.compactionChurn': '压力提醒：本轮上下文已压缩 {count} 次。检查是否在重复读取刚被压缩掉的内容。 (dsh-pressure)',

  'denial.dimension.sessionTokens': '会话 token',
  'denial.dimension.turnTokens': '单轮 token',
  'denial.dimension.turnToolCalls': '单轮工具调用',
  'denial.budget': 'dsh-pressure：{dimension}预算已用尽（{spent} / {limit}），新的工具调用已暂停，以便本轮收尾。你仍可用已有信息给出最终回答。可用 /squeeze budget 提高预算，或用 /squeeze mode observe 切回观察模式。注意：这是工具刹车，不是零超支保证，最终回答仍会计费。',

  'command.usage': [
    '用法：',
    '  /squeeze status',
    '  /squeeze report [轮次]',
    '  /squeeze mode observe|coach|enforce',
    '  /squeeze budget session <tokens> | turn <tokens> | tools <n>   （0 = 不限）',
    '  /squeeze flags',
    '  /squeeze mute <code> | unmute <code>',
    '  /squeeze purge --yes',
  ].join('\n'),
  'command.noBinding': '当前会话尚未在 dsh-pressure 中激活。先发一条消息，再重试。',
  'command.status': '模式={mode} · 会话 {sessionSpent}/{sessionLimit} tok · 本轮 {turnSpent}/{turnLimit} tok · 工具 {turnCalls}/{toolLimit} · 信号 {flags} · 回执 {receipts}',
  'command.limitNone': '不限',
  'command.modeSet': '当前会话模式已切换为 {mode}。',
  'command.invalidMode': '未知模式“{value}”。请使用 observe、coach 或 enforce。',
  'command.invalidNumber': '“{value}”不是非负整数。',
  'command.budgetSet': '{dimension}预算已设为 {value}（0 = 不限）。',
  'command.reportEmpty': '还没有 {target} 的回执。',
  'command.reportTitle': '回执 · {target}',
  'command.reportLine': 'token {total} · 缓存命中 {cache} · 工具 {calls} 次 / 失败 {failures} 次 · 信号 {signals}',
  'command.flagsEmpty': '本轮没有信号。',
  'command.flagsLine': '{code} ×{count}（{severity}）— {advice}',
  'command.muted': '已在本会话静音 {code}；回执仍会记录。',
  'command.unmuted': '已取消静音 {code}。',
  'command.unknownCode': '未知信号 code“{code}”。',
  'command.purged': '已删除本会话 {n} 条回执。',
  'command.purgeNeedsYes': '这会删除本会话的回执。请重新执行 /squeeze purge --yes 确认。',
  'command.purgeAllNotSupported': 'v0.1 不支持清空全部会话；请按会话执行。',

  'export.title': 'DSH Pressure 回执',
  'export.generatedAt': '由 dsh-pressure {version} 于 {time} 生成',
  'export.scopeNote': 'token 是运行体积（未缓存输入 + 输出 + 缓存读/写），不是账单金额。',
  'export.cacheFormula': '缓存命中率 = cacheRead / (cacheRead + input + cacheWrite)；分母为 0 时为未知。',
  'export.noBody': '不含 prompt 正文、工具参数、工具结果或密钥。',
  'export.none': '无',
  'export.unknown': '未知',
  'export.turn': '轮次',
  'export.started': '开始',
  'export.ended': '结束',
  'export.wall': '墙钟时间',
  'export.tokens': 'Token',
  'export.cacheHit': '缓存命中率',
  'export.context': '上下文压力',
  'export.tools': '工具',
  'export.budget': '预算',
  'export.signals': '信号',
  'export.advice': '下一步',
  'export.partial': '部分数据',
  'export.turnLine': '第 {turn} 轮 · {total} tok · 工具 {calls} 次 · 失败 {failures} 次 · 信号 {signals} 个',
  'export.csvHeader': 'sessionId,turn,startedAt,endedAt,wallMs,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,cacheHitRate,endPressure,observedPeak,observedFrom,toolCalls,toolFailures,toolRepeats,compactions,mode,sessionLimit,sessionSpent,overBudget,denied,flags,adviceKey,partial',
}

export const HOST_LOCALES = Object.freeze({ en: EN, zh: ZH })

/**
 * Resolve the Host locale from config, then `$DSH_LOCALE`, then LC_ALL/LANG,
 * then the JS runtime default. Chinese tags map to `zh`; everything else to `en`.
 * @param {{ locale?: 'auto' | 'zh' | 'en' }} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'zh' | 'en'}
 */
export function resolveHostLocale(config, env = process.env) {
  if (config?.locale === 'zh' || config?.locale === 'en') return config.locale
  const raw = env.DSH_LOCALE || env.LC_ALL || env.LC_MESSAGES || env.LANG
  if (typeof raw === 'string' && raw.toLowerCase().startsWith('zh')) return 'zh'
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale
    return String(resolved).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

/**
 * @param {string} locale
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function translate(locale, key, params) {
  const dictionary = HOST_LOCALES[locale === 'zh' ? 'zh' : 'en']
  const template = dictionary[key] ?? EN[key]
  if (template === undefined) return key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Translator bound to one locale.
 * @param {string} locale
 * @returns {(key: string, params?: Record<string, string | number>) => string}
 */
export function translator(locale) {
  return (key, params) => translate(locale, key, params)
}
