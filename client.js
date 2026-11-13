window.__ModuleLoader__.load({
  id: 'dsh-pressure',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const NS = 'dshPressure'
    const API = '/api/dsh-pressure'

    const DICT = {
      en: {
        navLabel: 'Pressure',
        pageTitle: 'Pressure',
        pageSubtitle: 'See where a turn spends tokens, context, and tool calls — then decide whether to brake.',
        session: 'Session',
        selectSession: 'Select a session',
        refresh: 'Refresh',
        loading: 'Loading…',
        emptyTitle: 'No receipts yet',
        emptyBody: 'Run one turn in any conversation, then come back. A receipt appears after the turn ends.',
        emptyLive: 'No live conversation is active. Open a conversation, send a message, then refresh.',
        errorTitle: 'Pressure could not load',
        retry: 'Retry',
        live: 'live',
        stored: 'stored',
        partial: 'partial data',
        tokens: 'Tokens',
        cacheHit: 'Cache hit',
        context: 'Context pressure',
        toolFailures: 'Tool failures',
        wall: 'Wall time',
        mode: 'Mode',
        observe: 'observe',
        coach: 'coach',
        enforce: 'enforce',
        turn: 'Turn',
        turns: 'Turns',
        calls: 'calls',
        signals: 'Signals',
        signalsTitle: 'Waste signals',
        noSignals: 'No signal in this turn.',
        kpis: 'Key readings',
        turnTable: 'Turns',
        turnCol: 'Turn',
        tokensCol: 'Tokens',
        cacheCol: 'Cache',
        toolsCol: 'Tools',
        failuresCol: 'Failed',
        flagsCol: 'Signals',
        timeCol: 'Ended',
        receipt: 'Receipt',
        close: 'Close',
        copyMarkdown: 'Copy Markdown',
        copied: 'Copied',
        export: 'Export',
        exportMd: 'Markdown',
        exportJson: 'JSON',
        exportCsv: 'CSV',
        about: 'About',
        version: 'Version',
        dataDir: 'Data directory',
        retention: 'Retention',
        thresholds: 'Default thresholds',
        privacy: 'Stores numbers, stable codes, and advice keys only. No prompt text, tool arguments, tool results, or keys.',
        privacyShort: 'No prompt or tool content is stored.',
        budget: 'Budget',
        spent: 'spent',
        limit: 'limit',
        unlimited: 'unlimited',
        contextBar: 'Context',
        budgetBar: 'Session budget',
        advice: 'Next step',
        unknown: 'unknown',
        notAvailable: 'unavailable',
        loadError: 'Request failed',
        modeHint: 'observe only records; coach adds short reminders; enforce pauses new tool calls after an observed overrun.',
        brakeNote: 'Token use is known only after a response, so enforce is a tool brake, not a zero-overspend guarantee.',
        observeNote: 'Default: measure without changing the model input.',
        retentionValue: '{days} days · {count} receipts/session · {bytes}',
        generated: 'Updated {time}',
        noDetail: 'Select a turn row to see its receipt.',
        receiptId: 'Receipt id',
        source: 'Measured at',
        turnWord: 'turn',
        tools: 'Tools',
        repeats: 'repeats',
        compactions: 'compactions',
        endPressure: 'End pressure',
        peakPressure: 'Peak pressure',
        cacheFormula: 'Cache hit = cacheRead / (cacheRead + input + cacheWrite)',
        wallMs: '{value}',
        modeSwitched: 'Mode is read from the live session; use /squeeze mode to change it.',
        unsupported: 'Not available with this installation',
        sessionIdLabel: 'Session id',
        'advice.none': 'No actionable signal in this turn.',
        'advice.inspectLastError': 'Inspect the last error before retrying; change the approach instead of repeating the call.',
        'advice.compactOrNarrow': 'Run /compact or narrow the task before reading more files.',
        'advice.convergeOrRaise': 'Summarize what is known and finish the step, or raise the budget with /squeeze budget.',
        'advice.narrowRead': 'Read a narrower range (offset/limit or grep) instead of the whole result.',
        'advice.avoidReReading': 'Check whether you are re-reading the same material after compaction.',
        'advice.changeApproach': 'Change the arguments or the approach instead of repeating the call.',
        'advice.toolsStopped': 'New tool calls are paused; answer with what you already have or raise the budget.',
      },
      zh: {
        navLabel: '压力表',
        pageTitle: '压力表',
        pageSubtitle: '看清一轮里的 token、上下文和工具调用花在哪，再决定要不要踩刹车。',
        session: '会话',
        selectSession: '选择会话',
        refresh: '刷新',
        loading: '加载中…',
        emptyTitle: '还没有回执',
        emptyBody: '在任意会话里跑一轮，结束后这里会出现一张回执。',
        emptyLive: '当前没有活动会话。打开一个会话、发一条消息，再刷新。',
        errorTitle: '压力表加载失败',
        retry: '重试',
        live: '实时',
        stored: '已存',
        partial: '部分数据',
        tokens: 'Token',
        cacheHit: '缓存命中',
        context: '上下文压力',
        toolFailures: '工具失败',
        wall: '墙钟时间',
        mode: '模式',
        observe: '观察',
        coach: '教练',
        enforce: '强制',
        turn: '轮次',
        turns: '轮次',
        calls: '次调用',
        signals: '信号',
        signalsTitle: '浪费信号',
        noSignals: '本轮没有信号。',
        kpis: '关键读数',
        noSignals: '本轮没有信号。',
        turnTable: '轮次',
        turnCol: '轮次',
        tokensCol: 'Token',
        cacheCol: '缓存',
        toolsCol: '工具',
        failuresCol: '失败',
        flagsCol: '信号',
        timeCol: '结束时间',
        receipt: '回执',
        close: '关闭',
        copyMarkdown: '复制 Markdown',
        copied: '已复制',
        export: '导出',
        exportMd: 'Markdown',
        exportJson: 'JSON',
        exportCsv: 'CSV',
        about: '关于',
        version: '版本',
        dataDir: '数据目录',
        retention: '保留策略',
        thresholds: '默认阈值',
        privacy: '只保存数字、稳定 code 和建议键；不保存 prompt 正文、工具参数、工具结果或密钥。',
        privacyShort: '不保存 prompt 与工具正文。',
        budget: '预算',
        spent: '已用',
        limit: '上限',
        unlimited: '不限',
        contextBar: '上下文',
        budgetBar: '会话预算',
        advice: '下一步',
        unknown: '未知',
        notAvailable: '不可用',
        loadError: '请求失败',
        modeHint: '观察只记录；教练追加短提醒；强制在观测到超限后暂停新的工具调用。',
        brakeNote: 'token 用量要等响应后才可知，所以强制模式是工具刹车，不是零超支保证。',
        observeNote: '默认模式：只测量，不改变模型输入。',
        retentionValue: '{days} 天 · 每会话 {count} 条 · {bytes}',
        generated: '更新于 {time}',
        noDetail: '点击一行轮次查看回执。',
        receiptId: '回执 ID',
        source: '测量时间',
        turnWord: '轮次',
        tools: '工具',
        repeats: '重复',
        compactions: '压缩',
        endPressure: '结束压力',
        peakPressure: '峰值压力',
        cacheFormula: '缓存命中 = cacheRead / (cacheRead + input + cacheWrite)',
        wallMs: '{value}',
        modeSwitched: '模式来自活动会话；用 /squeeze mode 修改。',
        unsupported: '当前安装不支持',
        sessionIdLabel: '会话 ID',
        'advice.none': '本轮没有可执行的信号。',
        'advice.inspectLastError': '先看最后一次错误，改变做法，不要原样重试。',
        'advice.compactOrNarrow': '先执行 /compact，或缩小任务范围，再继续读文件。',
        'advice.convergeOrRaise': '先总结已知信息并收尾，或用 /squeeze budget 提高预算。',
        'advice.narrowRead': '用 offset/limit 或 grep 读取更小的范围，不要整份读取。',
        'advice.avoidReReading': '检查是否在压缩后又重复读取同一批内容。',
        'advice.changeApproach': '换参数或换做法，不要重复同一次调用。',
        'advice.toolsStopped': '新的工具调用已暂停；用已有信息回答，或提高预算。',
      },
    }

    let translate = (key) => key
    let subscribeLocale = null

    function useLocale() {
      const [, force] = useState(0)
      useEffect(() => {
        if (typeof subscribeLocale !== 'function') return undefined
        return subscribeLocale(() => force((value) => value + 1))
      }, [])
      return translate
    }

    function formatNumber(value, locale) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value)
    }

    function formatPercent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${Math.round(value * 1000) / 10}%`
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      if (ms < 1000) return `${ms} ms`
      if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
      const minutes = Math.floor(ms / 60000)
      const seconds = Math.round((ms % 60000) / 1000)
      return `${minutes}m ${seconds}s`
    }

    function formatTime(iso, locale) {
      const value = Date.parse(iso)
      if (!Number.isFinite(value)) return '—'
      return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    }

    function localeCode() {
      const lang = (typeof document !== 'undefined' && (document.documentElement.lang || '')) || (typeof navigator !== 'undefined' ? navigator.language : '')
      return String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    async function apiGet(path) {
      const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
      let payload = null
      try {
        payload = await response.json()
      } catch {}
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(payload?.message || `HTTP ${response.status}`)
        error.code = payload?.code
        error.status = response.status
        throw error
      }
      return payload.data
    }

    function tokensTotal(tokens) {
      if (!tokens) return null
      if (typeof tokens.total === 'number') return tokens.total
      const parts = [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite]
      return parts.every((part) => typeof part === 'number') ? parts.reduce((sum, part) => sum + part, 0) : null
    }

    function cacheRate(tokens) {
      if (!tokens || typeof tokens.cacheRead !== 'number' || typeof tokens.input !== 'number' || typeof tokens.cacheWrite !== 'number') return null
      const denominator = tokens.cacheRead + tokens.input + tokens.cacheWrite
      return denominator > 0 ? tokens.cacheRead / denominator : null
    }

    function navIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      const color = props?.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', { d: 'M4 15a8 8 0 1 1 16 0' }),
        h('path', { d: 'M12 15 16 9' }),
        h('circle', { cx: 12, cy: 15, r: 1.4, fill: color, stroke: 'none' }),
        h('path', { d: 'M4 19h16' }),
      )
    }

    function SeverityDot(severity) {
      return h('span', {
        className: `dshp-dot dshp-dot-${severity}`,
        'aria-hidden': true,
      })
    }

    function Bar(label, value, detail) {
      const ratio = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
      const tone = ratio === null ? 'idle' : ratio >= 0.9 ? 'error' : ratio >= 0.8 ? 'warn' : 'ok'
      return h('div', { className: 'dshp-bar' },
        h('div', { className: 'dshp-bar-head' },
          h('span', null, label),
          h('span', { className: 'dshp-muted' }, detail),
        ),
        h('div', {
          className: 'dshp-track',
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': ratio === null ? 0 : Math.round(ratio * 100),
        }, h('div', { className: `dshp-fill dshp-fill-${tone}`, style: { width: `${ratio === null ? 0 : Math.round(ratio * 100)}%` } })),
        ratio === null ? h('span', { className: 'dshp-muted dshp-small' }, '—') : null,
      )
    }

    function receiptMarkdown(receipt, t, locale) {
      const lines = [
        `# ${t('receipt')} · ${t('turnWord')} ${receipt.turn}`,
        '',
        `- ${t('tokensCol')}: ${formatNumber(tokensTotal(receipt.tokens), locale)}`,
        `- ${t('cacheCol')}: ${formatPercent(receipt.tokens?.cacheHitRate)}`,
        `- ${t('context')}: ${formatPercent(receipt.context?.observedPeak)} (${receipt.context?.observedFrom ?? t('unknown')})`,
        `- ${t('toolsCol')}: ${receipt.tools?.calls ?? 0} ${t('calls')} / ${receipt.tools?.failures ?? 0} ${t('failuresCol')}`,
        `- ${t('budget')}: ${receipt.budget?.mode ?? '—'} · ${receipt.budget?.sessionSpent ?? 0} / ${receipt.budget?.sessionLimit ?? 0}`,
        '',
        `## ${t('signalsTitle')}`,
        ...(receipt.flags ?? []).map((flag) => `- ${flag.code} ×${flag.count} (${flag.severity}): ${t(flag.adviceKey)}`),
        ...(receipt.flags?.length ? [] : ['- —']),
        '',
        `## ${t('advice')}`,
        t(receipt.adviceKey ?? 'advice.none'),
        '',
        `${t('privacyShort')} ${t('cacheFormula')}`,
      ]
      return lines.join('\n')
    }

    function PressurePage() {
      const t = useLocale()
      const [health, setHealth] = useState(null)
      const [sessions, setSessions] = useState([])
      const [selectedId, setSelectedId] = useState(null)
      const [live, setLive] = useState(null)
      const [receipts, setReceipts] = useState([])
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState(null)
      const [ready, setReady] = useState(false)
      const [reloadKey, setReloadKey] = useState(0)
      const [copied, setCopied] = useState(false)
      const [updatedAt, setUpdatedAt] = useState(null)
      const locale = localeCode()

      useEffect(() => {
        let cancelled = false
        let timer = null
        const load = async () => {
          if (typeof document !== 'undefined' && document.hidden) {
            timer = setTimeout(load, 15000)
            return
          }
          try {
            const [healthData, sessionData, latest] = await Promise.all([
              apiGet('/health'),
              apiGet('/sessions?limit=50'),
              apiGet('/live'),
            ])
            if (cancelled) return
            setHealth(healthData)
            setSessions(sessionData.sessions ?? [])
            setUpdatedAt(Date.now())
            setSelectedId((previous) => previous ?? latest?.sessionId ?? sessionData.sessions?.[0]?.sessionId ?? null)
            setError(null)
            setReady(true)
          } catch (loadError) {
            if (!cancelled) setError(loadError)
          }
          timer = setTimeout(load, 15000)
        }
        load()
        const onVisible = () => {
          if (typeof document !== 'undefined' && !document.hidden) {
            clearTimeout(timer)
            load()
          }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          cancelled = true
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [reloadKey])

      useEffect(() => {
        if (selectedId === null) return undefined
        let cancelled = false
        let timer = null
        const load = async () => {
          if (typeof document !== 'undefined' && document.hidden) {
            timer = setTimeout(load, 3000)
            return
          }
          try {
            const [liveData, receiptData] = await Promise.all([
              apiGet(`/live?sessionId=${encodeURIComponent(selectedId)}`),
              apiGet(`/receipts?sessionId=${encodeURIComponent(selectedId)}&limit=50`),
            ])
            if (cancelled) return
            setLive(liveData)
            setReceipts(receiptData.receipts ?? [])
            setError(null)
          } catch (loadError) {
            if (!cancelled) setError(loadError)
          }
          timer = setTimeout(load, 3000)
        }
        load()
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [selectedId, reloadKey])

      const newest = receipts.length > 0 ? receipts[0] : null
      const isLive = live?.live === true
      const tokens = isLive ? live.tokens : newest?.tokens
      const total = tokensTotal(tokens)
      const rate = typeof tokens?.cacheHitRate === 'number' ? tokens.cacheHitRate : cacheRate(tokens)
      const contextRatio = isLive ? live.context?.pressure : newest?.context?.observedPeak
      const failures = isLive ? live.tools?.failures : newest?.tools?.failures
      const calls = isLive ? live.tools?.calls : newest?.tools?.calls
      const flags = isLive ? (live.flags ?? []) : (newest?.flags ?? [])
      const mode = isLive ? live.mode : (newest?.budget?.mode ?? health?.config?.mode)
      const budget = isLive ? live.budget : newest?.budget
      const sessionLimit = budget?.sessionTokens ?? 0
      const sessionSpent = budget?.sessionSpent ?? 0
      const budgetRatio = sessionLimit > 0 ? sessionSpent / sessionLimit : null
      const activeSession = sessions.find((entry) => entry.sessionId === selectedId)
      const showEmpty = ready && !error && sessions.length === 0 && !isLive

      const onCopy = async () => {
        if (newest === null) return
        try {
          await navigator.clipboard.writeText(receiptMarkdown(newest, t, locale))
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {}
      }

      if (!ready && !error) return h('div', { className: 'dshp-root' }, h('style', null, CSS), h('div', { className: 'dshp-state' }, t('loading')))

      return h('div', { className: 'dshp-root' },
        h('style', null, CSS),
        h('header', { className: 'dshp-header' },
          h('div', null,
            h('h1', { className: 'dshp-title' }, t('pageTitle')),
            h('p', { className: 'dshp-subtitle' }, t('pageSubtitle')),
          ),
          h('div', { className: 'dshp-header-actions' },
            h('label', { className: 'dshp-select-wrap' },
              h('span', { className: 'dshp-sr' }, t('session')),
              h('select', {
                className: 'dshp-select',
                value: selectedId ?? '',
                onChange: (event) => {
                  setSelectedId(event.target.value || null)
                  setDetail(null)
                },
                'aria-label': t('session'),
              },
                sessions.length === 0 && !isLive ? h('option', { value: '' }, t('selectSession')) : null,
                sessions.map((entry) => h('option', { key: entry.sessionId, value: entry.sessionId },
                  `${entry.sessionId.slice(0, 12)}… · ${entry.receipts} ${t('turns')}`)),
                isLive && !sessions.some((entry) => entry.sessionId === live.sessionId)
                  ? h('option', { value: live.sessionId }, `${live.sessionId.slice(0, 12)}… · ${t('live')}`)
                  : null,
              ),
            ),
            h('span', { className: `dshp-pill ${isLive ? 'dshp-pill-live' : ''}` }, isLive ? t('live') : t('stored')),
            h('button', {
              type: 'button',
              className: 'dshp-btn',
              onClick: () => setReloadKey((value) => value + 1),
            }, t('refresh')),
          ),
        ),
        error !== null
          ? h('div', { className: 'dshp-banner dshp-banner-error', role: 'alert' },
              h('strong', null, t('errorTitle')),
              h('span', null, `${error.message}${error.code ? ` · ${error.code}` : ''}`),
              h('button', { type: 'button', className: 'dshp-btn', onClick: () => setReloadKey((value) => value + 1) }, t('retry')),
            )
          : null,
        showEmpty
          ? h('div', { className: 'dshp-state dshp-empty' },
              h('h2', null, t('emptyTitle')),
              h('p', null, t('emptyBody')),
            )
          : null,
        h('section', { className: 'dshp-kpis', 'aria-label': t('kpis') },
          Kpi(t('tokens'), formatNumber(total, locale), isLive && live.partial ? t('partial') : null),
          Kpi(t('cacheHit'), formatPercent(rate), t('cacheFormula')),
          Kpi(t('context'), formatPercent(contextRatio), isLive ? t('live') : (newest?.context?.observedFrom ?? null)),
          Kpi(t('toolFailures'), `${failures ?? 0} / ${calls ?? 0}`, t('calls')),
          Kpi(t('wall'), formatDuration(newest?.wallMs), isLive ? `${live.turn} ${t('turnWord')}` : null),
          Kpi(t('mode'), t(mode ?? 'observe'), t('modeHint')),
        ),
        h('section', { className: 'dshp-grid' },
          h('div', { className: 'dshp-card' },
            h('h2', null, t('signalsTitle')),
            h('div', { className: 'dshp-bars' },
              Bar(t('contextBar'), contextRatio, formatPercent(contextRatio)),
              Bar(t('budgetBar'), budgetRatio, sessionLimit > 0
                ? `${formatNumber(sessionSpent, locale)} / ${formatNumber(sessionLimit, locale)}`
                : t('unlimited')),
            ),
            h('p', { className: 'dshp-muted dshp-small' }, t('brakeNote')),
            h('h3', null, t('signals')),
            flags.length === 0
              ? h('p', { className: 'dshp-muted' }, t('noSignals'))
              : h('ul', { className: 'dshp-flags' },
                  flags.map((flag) => h('li', { key: flag.code, className: `dshp-flag dshp-flag-${flag.severity}` },
                    SeverityDot(flag.severity),
                    h('div', { className: 'dshp-flag-body' },
                      h('div', { className: 'dshp-flag-title' },
                        h('code', null, flag.code),
                        h('span', { className: 'dshp-muted' }, ` ×${flag.count} · ${flag.severity}`),
                      ),
                      h('p', { className: 'dshp-small' }, t(flag.adviceKey)),
                    ),
                  )),
                ),
          ),
          h('div', { className: 'dshp-card' },
            h('div', { className: 'dshp-card-head' },
              h('h2', null, t('turnTable')),
              newest !== null
                ? h('div', { className: 'dshp-export' },
                    h('a', { className: 'dshp-btn', href: `${API}/export?sessionId=${encodeURIComponent(selectedId)}&format=md`, download: true }, t('exportMd')),
                    h('a', { className: 'dshp-btn', href: `${API}/export?sessionId=${encodeURIComponent(selectedId)}&format=csv`, download: true }, t('exportCsv')),
                    h('a', { className: 'dshp-btn', href: `${API}/export?sessionId=${encodeURIComponent(selectedId)}&format=json`, download: true }, t('exportJson')),
                  )
                : null,
            ),
            receipts.length === 0
              ? h('p', { className: 'dshp-muted' }, isLive ? t('noDetail') : t('emptyBody'))
              : h('div', { className: 'dshp-table-wrap' },
                  h('table', { className: 'dshp-table' },
                    h('caption', { className: 'dshp-sr' }, t('turnTable')),
                    h('thead', null, h('tr', null,
                      h('th', { scope: 'col' }, t('turnCol')),
                      h('th', { scope: 'col' }, t('tokensCol')),
                      h('th', { scope: 'col' }, t('cacheCol')),
                      h('th', { scope: 'col' }, t('toolsCol')),
                      h('th', { scope: 'col' }, t('failuresCol')),
                      h('th', { scope: 'col' }, t('flagsCol')),
                      h('th', { scope: 'col' }, t('timeCol')),
                    )),
                    h('tbody', null, receipts.map((receipt) => h('tr', {
                      key: receipt.turn,
                      tabIndex: 0,
                      className: detail?.turn === receipt.turn ? 'dshp-row-active' : '',
                      onClick: () => setDetail(receipt),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setDetail(receipt)
                        }
                      },
                    },
                      h('td', null, receipt.turn),
                      h('td', null, formatNumber(tokensTotal(receipt.tokens), locale)),
                      h('td', null, formatPercent(receipt.tokens?.cacheHitRate)),
                      h('td', null, `${receipt.tools?.calls ?? 0} (${receipt.tools?.repeats ?? 0} ${t('repeats')})`),
                      h('td', null, receipt.tools?.failures ?? 0),
                      h('td', null, (receipt.flags ?? []).map((flag) => flag.code).join(', ') || '—'),
                      h('td', null, formatTime(receipt.endedAt, locale)),
                    ))),
                  ),
                ),
          ),
        ),
        h('section', { className: 'dshp-card dshp-about' },
          h('h2', null, t('about')),
          h('dl', { className: 'dshp-dl' },
            dtDd(t('version'), health?.version ?? '—'),
            dtDd(t('dataDir'), health?.dataDir ?? '—'),
            dtDd(t('retention'), health
              ? t('retentionValue', {
                  days: health.config?.storage?.retentionDays ?? '—',
                  count: health.config?.storage?.maxReceiptsPerSession ?? '—',
                  bytes: health.config?.storage?.maxTotalBytes ?? '—',
                })
              : '—'),
            dtDd(t('thresholds'), health
              ? `context ${health.config?.thresholds?.contextPressure} · budget ${health.config?.thresholds?.budgetPressure} · fail ${health.config?.thresholds?.failureStreak} · bloat ${health.config?.thresholds?.bloatedResultTokens} · compact ${health.config?.thresholds?.compactionChurn}`
              : '—'),
            dtDd(t('privacy'), t('privacy')),
          ),
          updatedAt !== null ? h('p', { className: 'dshp-muted dshp-small' }, t('generated', { time: formatTime(new Date(updatedAt).toISOString(), locale) })) : null,
        ),
        detail !== null
          ? h('div', { className: 'dshp-drawer-backdrop', onClick: () => setDetail(null) },
              h('aside', {
                className: 'dshp-drawer',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': `${t('receipt')} · ${detail.turn}`,
                onClick: (event) => event.stopPropagation(),
              },
                h('div', { className: 'dshp-card-head' },
                  h('h2', null, `${t('receipt')} · ${t('turnWord')} ${detail.turn}`),
                  h('button', { type: 'button', className: 'dshp-btn', onClick: () => setDetail(null), 'aria-label': t('close') }, t('close')),
                ),
                h('dl', { className: 'dshp-dl' },
                  dtDd(t('tokensCol'), formatNumber(tokensTotal(detail.tokens), locale)),
                  dtDd(t('cacheCol'), formatPercent(detail.tokens?.cacheHitRate)),
                  dtDd(t('context' ) + ' · ' + t('peakPressure'), formatPercent(detail.context?.observedPeak)),
                  dtDd(t('endPressure'), formatPercent(detail.context?.endPressure)),
                  dtDd(t('wall'), formatDuration(detail.wallMs)),
                  dtDd(t('tools'), `${detail.tools?.calls ?? 0} ${t('calls')} · ${detail.tools?.failures ?? 0} ${t('failuresCol')} · ${detail.tools?.repeats ?? 0} ${t('repeats')} · ${detail.context?.compactions ?? 0} ${t('compactions')}`),
                  dtDd(t('budget'), `${detail.budget?.mode ?? '—'} · ${formatNumber(detail.budget?.sessionSpent ?? 0, locale)} / ${detail.budget?.sessionLimit > 0 ? formatNumber(detail.budget.sessionLimit, locale) : t('unlimited')}`),
                  dtDd(t('advice'), t(detail.adviceKey ?? 'advice.none')),
                  dtDd(t('signals'), (detail.flags ?? []).map((flag) => `${flag.code} ×${flag.count}`).join(', ') || t('noSignals')),
                  dtDd(t('receiptId'), detail.id ?? '—'),
                  dtDd(t('source'), detail.source?.measuredAt ? formatTime(detail.source.measuredAt, locale) : '—'),
                ),
                h('div', { className: 'dshp-drawer-actions' },
                  h('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', onClick: onCopy }, copied ? t('copied') : t('copyMarkdown')),
                  h('a', { className: 'dshp-btn', href: `${API}/export?sessionId=${encodeURIComponent(selectedId)}&format=md`, download: true }, t('exportMd')),
                  h('a', { className: 'dshp-btn', href: `${API}/export?sessionId=${encodeURIComponent(selectedId)}&format=json`, download: true }, t('exportJson')),
                ),
                h('p', { className: 'dshp-muted dshp-small' }, t('privacy')),
              ),
            )
          : null,
      )
    }

    function Kpi(label, value, hint) {
      return h('div', { className: 'dshp-kpi', key: label },
        h('span', { className: 'dshp-kpi-label' }, label),
        h('strong', { className: 'dshp-kpi-value' }, value),
        hint ? h('span', { className: 'dshp-muted dshp-small' }, hint) : null,
      )
    }

    function dtDd(term, description) {
      return h('div', { className: 'dshp-dl-row' },
        h('dt', null, term),
        h('dd', null, description),
      )
    }

    const CSS = `
.dshp-root { display: flex; flex-direction: column; gap: 16px; padding: 20px 22px 32px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); min-height: 100%; box-sizing: border-box; overflow: auto; }
.dshp-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.dshp-title { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
.dshp-subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; max-width: 640px; line-height: 1.5; }
.dshp-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshp-select-wrap { display: inline-flex; align-items: center; gap: 6px; }
.dshp-select { max-width: 240px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
.dshp-btn { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; text-decoration: none; }
.dshp-btn:hover { border-color: var(--dsw-alias-border-l2); }
.dshp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshp-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dshp-pill { padding: 3px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dshp-pill-live { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }
.dshp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.dshp-kpi { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.dshp-kpi-label { font-size: 11px; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.dshp-kpi-value { font-size: 20px; font-weight: 600; }
.dshp-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 12px; }
.dshp-card { padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; min-width: 0; }
.dshp-card h2 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
.dshp-card h3 { margin: 14px 0 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.dshp-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
.dshp-card-head h2 { margin: 0; }
.dshp-bars { display: flex; flex-direction: column; gap: 12px; }
.dshp-bar-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 4px; }
.dshp-track { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dshp-fill { height: 100%; border-radius: 999px; }
.dshp-fill-ok { background: var(--dsw-alias-state-success-primary); }
.dshp-fill-warn { background: var(--dsw-alias-state-warn-primary); }
.dshp-fill-error { background: var(--dsw-alias-state-error-primary); }
.dshp-fill-idle { background: var(--dsw-alias-state-idle-primary); }
.dshp-flags { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dshp-flag { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.dshp-flag p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); }
.dshp-flag-title { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.dshp-flag-title code { font-size: 12px; }
.dshp-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex: none; }
.dshp-dot-info { background: var(--dsw-alias-state-idle-primary); }
.dshp-dot-warn { background: var(--dsw-alias-state-warn-primary); }
.dshp-dot-high { background: var(--dsw-alias-state-error-primary); }
.dshp-table-wrap { overflow: auto; }
.dshp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dshp-table th { text-align: left; font-weight: 600; color: var(--dsw-alias-label-secondary); padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.dshp-table td { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.dshp-table tbody tr { cursor: pointer; }
.dshp-table tbody tr:hover, .dshp-row-active { background: var(--dsw-alias-bg-layer-2); }
.dshp-table tbody tr:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dshp-export { display: flex; gap: 6px; flex-wrap: wrap; }
.dshp-about .dshp-dl { margin-bottom: 6px; }
.dshp-dl { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dshp-dl-row { display: grid; grid-template-columns: minmax(110px, 180px) minmax(0, 1fr); gap: 10px; font-size: 12px; }
.dshp-dl dt { color: var(--dsw-alias-label-secondary); }
.dshp-dl dd { margin: 0; overflow-wrap: anywhere; }
.dshp-muted { color: var(--dsw-alias-label-secondary); }
.dshp-small { font-size: 11px; }
.dshp-state { padding: 32px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dshp-empty h2 { margin: 0 0 6px; color: var(--dsw-alias-label-primary); font-size: 16px; }
.dshp-banner { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 10px; font-size: 12px; }
.dshp-banner-error { color: var(--dsw-alias-state-error-primary); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.dshp-drawer-backdrop { position: fixed; inset: 0; background: color-mix(in srgb, #000 36%, transparent); display: flex; justify-content: flex-end; z-index: 40; }
.dshp-drawer { width: min(560px, 92vw); height: 100%; overflow: auto; padding: 18px 20px; background: var(--dsw-alias-bg-overlay); border-left: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
.dshp-drawer-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dshp-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (max-width: 900px) { .dshp-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) { .dshp-root { padding: 14px; } .dshp-dl-row { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT))
        translate = ctx.locale.bind(NS)
        subscribeLocale = (listener) => ctx.locale.subscribe(listener)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'pressure',
          order: 35,
          label: () => translate('navLabel'),
        }, navIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'pressure',
        }, PressurePage))
      },
    }
  },
})
