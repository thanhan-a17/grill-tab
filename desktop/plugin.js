import {
  atom,
  Button,
  Codicon,
  COMPOSER_AREAS,
  host,
  Kbd,
  KbdGroup,
  KEYBINDS_AREA,
  PALETTE_AREA,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'grill-tab'

// @core-start
export function initialGrillState() {
  return {
    answer: '',
    brief: '',
    current: null,
    escapeArmed: false,
    force: false,
    intent: '',
    ladder: [],
    reason: '',
    restoreIntent: '',
    status: 'idle'
  }
}

function asRung(current, answer) {
  return {
    answer: answer || current.recommended || '',
    category: current.category ?? null,
    question: current.question || '',
    recommended: current.recommended || '',
    settledFromRecommendation: false
  }
}

function withCommittedCurrent(state, answer) {
  if (!state.current) return state
  return {
    ...state,
    answer: '',
    current: null,
    escapeArmed: false,
    ladder: [...state.ladder, asRung(state.current, answer ?? state.answer)]
  }
}

export function reduceGrill(state, action) {
  switch (action.type) {
    case 'START':
      return {
        ...initialGrillState(),
        intent: action.intent,
        status: 'asking'
      }
    case 'SET_ANSWER':
      return state.status === 'active' ? { ...state, answer: action.answer, escapeArmed: false } : state
    case 'COMMIT_ANSWER': {
      if (state.status !== 'active' || !state.current) return state
      return { ...withCommittedCurrent(state, action.answer), status: 'asking' }
    }
    case 'INTERROGATION': {
      if (state.status !== 'asking') return state
      const response = action.response || {}
      const ladder = response.settled_from_recommendation && state.ladder.length
        ? state.ladder.map((rung, index) =>
            index === state.ladder.length - 1
              ? { ...rung, answer: rung.recommended, settledFromRecommendation: true }
              : rung
          )
        : state.ladder
      if (response.done) {
        return { ...state, current: null, force: false, ladder, reason: response.reason || '', status: 'done' }
      }
      return {
        ...state,
        answer: '',
        current: {
          category: response.category ?? null,
          options: Array.isArray(response.options) ? response.options : [],
          question: response.question || '',
          recommended: response.recommended || ''
        },
        escapeArmed: false,
        force: false,
        ladder,
        status: 'active'
      }
    }
    case 'FORCE_DONE':
      return state.status === 'done' ? { ...state, force: true, status: 'asking' } : state
    case 'WRITE_BRIEF': {
      if (state.status !== 'active' && state.status !== 'done') return state
      const next = action.includeCurrent ? withCommittedCurrent(state, action.answer) : state
      return { ...next, status: 'briefing' }
    }
    case 'BRIEF_READY':
      return state.status === 'briefing' ? { ...state, brief: action.brief || '', status: 'preview' } : state
    case 'BACK_TO_LADDER':
      return state.status === 'preview' ? { ...state, brief: '', status: 'done' } : state
    case 'BACKSPACE_EMPTY': {
      if (state.status !== 'active' || state.answer || !state.ladder.length) return state
      const previous = state.ladder[state.ladder.length - 1]
      return {
        ...state,
        answer: previous.answer,
        current: {
          category: previous.category,
          options: [],
          question: previous.question,
          recommended: previous.recommended
        },
        escapeArmed: false,
        ladder: state.ladder.slice(0, -1)
      }
    }
    case 'REOPEN_RUNG': {
      if (!['active', 'done'].includes(state.status) || action.index < 0 || action.index >= state.ladder.length) return state
      const rung = state.ladder[action.index]
      return {
        ...state,
        answer: rung.answer,
        current: {
          category: rung.category,
          options: [],
          question: rung.question,
          recommended: rung.recommended
        },
        escapeArmed: false,
        ladder: state.ladder.slice(0, action.index),
        status: 'active'
      }
    }
    case 'ESC':
      if (state.status === 'preview') return { ...state, brief: '', status: 'done' }
      if (state.status !== 'active') return state
      if (state.escapeArmed) return { ...initialGrillState(), restoreIntent: state.intent }
      return { ...state, answer: '', current: null, escapeArmed: true }
    case 'RESET':
      return initialGrillState()
    default:
      return state
  }
}

export function shouldStartFromTab(event, env) {
  return Boolean(
    event?.key === 'Tab' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      env?.status === 'idle' &&
      env.isComposerTarget(event.target) &&
      String(env.readDraft() || '').trim() &&
      !env.isPopoverOpen()
  )
}

export function fallbackBrief(intent, ladder) {
  const decisions = (ladder || [])
    .filter(rung => rung.question && rung.answer)
    .map(rung => `- ${rung.category ? `${rung.category[0].toUpperCase()}${rung.category.slice(1)} — ` : ''}${rung.question}: ${rung.answer}`)
  const sections = [`## Goal\n${intent}`]
  if (decisions.length) sections.push(`## Settled decisions\n${decisions.join('\n')}`)
  sections.push('## Assumptions to make explicitly (do not ask)\n- None captured in the ladder.')
  sections.push('## Directive\nWork autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief.')
  return sections.join('\n\n')
}
// @core-end

const $grill = atom(initialGrillState())
let requestSerial = 0
let pluginContext = null

// This is the only module that selects or imperatively writes app-owned DOM.
// Selector provenance is documented in desktop/README-DEV.md.
const composerAdapter = {
  tabListener: null,

  getRoot() {
    // index.tsx:1243-1277 creates the root; :1313-1326 distinguishes the live composer from its fallback root.
    return document.querySelector('[data-slot="composer-root"]:has([data-slot="composer-surface"])')
  },

  getInput() {
    const root = this.getRoot()
    if (!root) return null
    // rich-editor.ts:22 defines this slot; index.tsx:1053-1113 renders the visible contenteditable editor.
    return root.querySelector('[data-slot="composer-surface"] [data-slot="composer-rich-input"][role="textbox"]')
      // Legacy-compatible textarea path. index.tsx:1130-1140's aria-hidden textarea is deliberately excluded.
      || root.querySelector('[data-slot="composer-surface"] textarea:not([aria-hidden])')
  },

  readDraft() {
    const input = this.getInput()
    if (!input) return ''
    return input instanceof HTMLTextAreaElement ? input.value : input.textContent || ''
  },

  writeDraft(text) {
    const input = this.getInput()
    if (!input) return false
    if (input instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, text)
    } else {
      input.textContent = text
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    this.focusComposer()
    return true
  },

  async submit() {
    const input = this.getInput()
    if (!input) return false
    // index.tsx:1105 binds editor keydown; :1268-1276 owns form submit. Synthetic events cannot be trusted,
    // but this carries the same Enter fields before the documented button fallback below.
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
      keyCode: 13,
      which: 13
    }))
    await new Promise(resolve => setTimeout(resolve, 150))
    if (!this.readDraft().trim()) return true
    const root = this.getRoot()
    // controls.tsx:144-149 renders the submit button with type="submit" and a localized aria-label.
    const sendButton = root?.querySelector('[data-slot="composer-surface"] button[type="submit"][aria-label]')
    if (!(sendButton instanceof HTMLElement) || sendButton.hasAttribute('disabled')) return false
    sendButton.click()
    return true
  },

  isPopoverOpen() {
    const root = this.getRoot()
    // trigger-popover.tsx:154-162 marks an open completion drawer as listbox with this slot/state pair.
    return Boolean(root?.querySelector('[data-slot="composer-completion-drawer"][data-state="open"][role="listbox"]'))
  },

  focusComposer() {
    const input = this.getInput()
    if (!(input instanceof HTMLElement)) return false
    input.focus()
    if (input.isContentEditable) {
      const range = document.createRange()
      range.selectNodeContents(input)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    return true
  },

  isComposerTarget(element) {
    if (!(element instanceof Element)) return false
    const root = this.getRoot()
    // The visible target is the contenteditable, not index.tsx:1130-1140's sr-only binding textarea.
    return Boolean(root && root.contains(element) && element.matches('[data-slot="composer-rich-input"][role="textbox"]'))
  },

  installTabListener(onStart) {
    this.tabListener = event => {
      const state = $grill.get()
      if (!shouldStartFromTab(event, { ...this, status: state.status })) return
      event.preventDefault()
      event.stopPropagation()
      onStart()
    }
    document.addEventListener('keydown', this.tabListener, true)
  },

  dispose() {
    if (this.tabListener) document.removeEventListener('keydown', this.tabListener, true)
    this.tabListener = null
  }
}

function update(action) {
  $grill.set(reduceGrill($grill.get(), action))
}

function contractLadder(ladder) {
  return ladder.map(({ answer, category, question }) => ({ answer, category, question }))
}

async function askNext() {
  const state = $grill.get()
  if (state.status !== 'asking' || !pluginContext) return
  const serial = ++requestSerial
  try {
    const response = await pluginContext.rest('/interrogate', {
      method: 'POST',
      body: {
        cwd: host.state.cwd.get() ?? null,
        force: Boolean(state.force),
        ladder: contractLadder(state.ladder),
        profile: host.state.profile.get() ?? null,
        text: state.intent
      }
    })
    if (serial !== requestSerial) return
    update({ type: 'INTERROGATION', response })
  } catch (error) {
    if (serial !== requestSerial) return
    host.notifyError(error, 'Grill engine unavailable; continuing without another question.')
    update({ type: 'INTERROGATION', response: { done: true, reason: 'engine unavailable' } })
  }
}

function startFromComposer() {
  const state = $grill.get()
  const intent = composerAdapter.readDraft().trim()
  if (state.status !== 'idle' || !intent) return
  update({ type: 'START', intent })
  void askNext()
}

function commitAnswer() {
  const state = $grill.get()
  if (state.status !== 'active') return
  update({ type: 'COMMIT_ANSWER', answer: state.answer })
  void askNext()
}

function forceOneMore() {
  if ($grill.get().status !== 'done') return
  update({ type: 'FORCE_DONE' })
  void askNext()
}

async function writeBrief() {
  const state = $grill.get()
  if (!['active', 'done'].includes(state.status) || !pluginContext) return
  update({ type: 'WRITE_BRIEF', answer: state.answer, includeCurrent: state.status === 'active' })
  const requestState = $grill.get()
  const serial = ++requestSerial
  try {
    const response = await pluginContext.rest('/brief', {
      method: 'POST',
      body: {
        cwd: host.state.cwd.get() ?? null,
        ladder: contractLadder(requestState.ladder),
        profile: host.state.profile.get() ?? null,
        text: requestState.intent
      }
    })
    if (serial !== requestSerial) return
    update({ type: 'BRIEF_READY', brief: typeof response?.brief === 'string' && response.brief.trim() ? response.brief : fallbackBrief(requestState.intent, requestState.ladder) })
  } catch (error) {
    if (serial !== requestSerial) return
    host.notifyError(error, 'Brief model unavailable; using the local template.')
    update({ type: 'BRIEF_READY', brief: fallbackBrief(requestState.intent, requestState.ladder) })
  }
}

async function launchBrief() {
  const state = $grill.get()
  if (state.status !== 'preview' || !state.brief) return
  if (!composerAdapter.writeDraft(state.brief)) {
    host.notify({ kind: 'error', message: 'Could not write the brief into the composer.' })
    return
  }
  const submitted = await composerAdapter.submit()
  if (!submitted) {
    host.notify({ kind: 'error', message: 'Could not submit the brief. It remains in the composer.' })
    return
  }
  requestSerial += 1
  update({ type: 'RESET' })
}

function exitToComposer() {
  const state = $grill.get()
  requestSerial += 1
  update({ type: 'ESC' })
  const next = $grill.get()
  if (next.restoreIntent) {
    composerAdapter.writeDraft(next.restoreIntent)
    update({ type: 'RESET' })
  }
}

const typeStyle = { color: 'var(--ui-text-secondary)', fontFamily: 'var(--dt-font-sans, sans-serif)' }
const monoStyle = { color: 'var(--ui-text-quaternary)', fontFamily: 'var(--dt-font-mono, monospace)' }

function HintRow({ done = false }) {
  return jsxs('div', {
    style: { ...monoStyle, alignItems: 'center', display: 'flex', flexWrap: 'wrap', fontSize: '11px', gap: '6px', marginTop: '8px' },
    children: done
      ? [
          jsx(KbdGroup, { keys: ['Enter'], size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'write brief ·' }),
          jsx(Kbd, { children: 'Tab', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'one more question' })
        ]
      : [
          jsx(Kbd, { children: 'Tab', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'next ·' }),
          jsx(Kbd, { children: 'Enter', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'write brief ·' }),
          jsx(Kbd, { children: 'Esc', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'dismiss' })
        ]
  })
}

function Ladder({ ladder }) {
  if (!ladder.length) return null
  return jsx('div', {
    style: { display: 'grid', gap: '8px', marginTop: '16px' },
    children: ladder.map((rung, index) =>
      jsxs('button', {
        className: 'hover:underline',
        key: `${rung.question}-${index}`,
        onClick: () => update({ type: 'REOPEN_RUNG', index }),
        style: {
          ...typeStyle,
          alignItems: 'baseline',
          border: 0,
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr) minmax(0, 0.8fr)',
          minWidth: 0,
          padding: 0,
          textAlign: 'left'
        },
        type: 'button',
        children: [
          jsx('span', { style: { ...monoStyle, fontSize: '12px' }, children: String(index + 1).padStart(2, '0') }),
          jsx('span', { style: { fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: rung.question, children: rung.question }),
          jsx(Tip, {
            label: rung.answer,
            children: jsx('span', {
              style: { color: 'var(--ui-text-quaternary)', fontSize: '12px', minWidth: 0, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              children: `${rung.answer}${rung.settledFromRecommendation ? ' (recommended)' : ''}`
            })
          })
        ]
      })
    )
  })
}

function ActiveQuestion({ state }) {
  const current = state.current
  if (!current) {
    return jsx('button', {
      autoFocus: true,
      onClick: exitToComposer,
      onKeyDown: event => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        exitToComposer()
      },
      style: { ...typeStyle, border: 0, cursor: 'pointer', fontSize: '14px', fontWeight: 500, marginTop: '16px', padding: 0, textAlign: 'left' },
      type: 'button',
      children: 'Question dismissed. Press Esc again to restore the intent.'
    })
  }
  return jsxs('div', {
    style: { marginTop: '16px' },
    children: [
      jsx('div', { style: { ...typeStyle, fontSize: '14px', fontWeight: 500 }, children: current.question }),
      jsx('input', {
        'aria-label': 'Grill answer',
        autoFocus: true,
        onBlur: event => { event.currentTarget.style.borderColor = 'var(--ui-stroke-secondary)' },
        onChange: event => update({ type: 'SET_ANSWER', answer: event.currentTarget.value }),
        onFocus: event => { event.currentTarget.style.borderColor = 'var(--ui-accent)' },
        onKeyDown: event => {
          if (event.isComposing) return
          if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            commitAnswer()
          } else if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            void writeBrief()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            exitToComposer()
          } else if (event.key === 'Backspace' && !state.answer) {
            event.preventDefault()
            update({ type: 'BACKSPACE_EMPTY' })
          }
        },
        placeholder: current.recommended ? `↵ recommended: ${current.recommended}` : 'Answer this decision',
        style: {
          ...typeStyle,
          background: 'transparent',
          border: 0,
          borderBottom: '1px solid var(--ui-stroke-secondary)',
          borderRadius: 0,
          boxSizing: 'border-box',
          fontSize: '14px',
          marginTop: '8px',
          outline: 'none',
          padding: '6px 0',
          width: '100%'
        },
        value: state.answer
      }),
      current.options.length
        ? jsx('div', {
            style: { ...typeStyle, display: 'flex', flexWrap: 'wrap', fontSize: '12px', gap: '8px', marginTop: '8px' },
            children: current.options.map(option => jsx('button', {
              className: 'hover:underline',
              key: option,
              onClick: () => update({ type: 'SET_ANSWER', answer: option }),
              style: { ...typeStyle, border: 0, cursor: 'pointer', padding: 0 },
              type: 'button',
              children: option
            }))
          })
        : null,
      jsx(HintRow, {}),
      jsx('div', {
        style: { display: 'flex', gap: '8px', marginTop: '12px' },
        children: jsx(Button, { onClick: () => void writeBrief(), size: 'sm', type: 'button', variant: 'ghost', children: 'Write brief' })
      })
    ]
  })
}

function Preview({ state }) {
  return jsxs('div', {
    autoFocus: true,
    onKeyDown: event => {
      if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        void launchBrief()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        update({ type: 'BACK_TO_LADDER' })
      }
    },
    style: { marginTop: '16px' },
    tabIndex: -1,
    children: [
      jsx('div', {
        style: { ...monoStyle, fontSize: '11px', maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' },
        children: state.brief
      }),
      jsx('div', {
        style: { display: 'flex', gap: '8px', marginTop: '12px' },
        children: [
          jsx(Button, {
            onClick: async () => {
              const copied = await pluginContext?.os?.writeClipboard(state.brief)
              host.notify({ kind: copied ? 'info' : 'error', message: copied ? 'Brief copied.' : 'Could not copy the brief.' })
            },
            size: 'sm',
            type: 'button',
            variant: 'ghost',
            children: jsxs('span', { style: { alignItems: 'center', display: 'inline-flex', gap: '4px' }, children: [jsx(Codicon, { name: 'copy', size: '0.875rem' }), 'Copy'] })
          }),
          jsx(Button, { onClick: () => void launchBrief(), size: 'sm', type: 'button', variant: 'ghost', children: 'Launch' })
        ]
      })
    ]
  })
}

function GrillLadder() {
  const state = useValue($grill)
  if (state.status === 'idle') return null
  const body =
    state.status === 'asking'
      ? jsx('div', { style: { ...typeStyle, fontSize: '14px', fontWeight: 500, marginTop: '16px' }, children: 'Finding the next decision…' })
      : state.status === 'briefing'
        ? jsx('div', { style: { ...typeStyle, fontSize: '14px', fontWeight: 500, marginTop: '16px' }, children: 'Writing the brief…' })
        : state.status === 'active'
          ? jsx(ActiveQuestion, { state })
          : state.status === 'done'
            ? jsxs('div', {
                style: { marginTop: '16px' },
                children: [
                  jsx('div', { style: { ...typeStyle, fontSize: '14px', fontWeight: 500 }, children: 'Nothing critical left.' }),
                  jsx('button', {
                    autoFocus: true,
                    onClick: () => void writeBrief(),
                    onKeyDown: event => {
                      if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        event.preventDefault()
                        event.stopPropagation()
                        forceOneMore()
                      } else if (event.key === 'Enter') {
                        event.preventDefault()
                        event.stopPropagation()
                        void writeBrief()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        exitToComposer()
                      }
                    },
                    style: { border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' },
                    type: 'button',
                    children: jsx(HintRow, { done: true })
                  }),
                  jsx('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' }, children: jsx(Button, { onClick: forceOneMore, size: 'sm', type: 'button', variant: 'ghost', children: 'One more question' }) })
                ]
              })
            : jsx(Preview, { state })

  return jsxs('div', {
    style: { padding: '0 12px 12px' },
    children: [
      jsxs('div', {
        style: { alignItems: 'baseline', display: 'flex', gap: '8px', minWidth: 0 },
        children: [
          jsx('span', { style: { ...monoStyle, fontSize: '10px', letterSpacing: '0.12em' }, children: 'INTENT' }),
          jsx('span', { style: { ...typeStyle, fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: state.intent, children: state.intent })
        ]
      }),
      jsx(Ladder, { ladder: state.ladder }),
      body
    ]
  })
}

export default {
  id: ID,
  name: 'Grill Tab',
  register(ctx) {
    pluginContext = ctx
    composerAdapter.installTabListener(startFromComposer)
    ctx.onDispose(() => {
      requestSerial += 1
      composerAdapter.dispose()
      pluginContext = null
      $grill.set(initialGrillState())
    })
    ctx.registerMany([
      {
        id: 'ladder',
        area: COMPOSER_AREAS.top,
        render: () => jsx(GrillLadder, {})
      },
      {
        id: 'middleware',
        area: COMPOSER_AREAS.middleware,
        data: { handler: draft => ($grill.get().status === 'briefing' ? null : draft) }
      },
      {
        id: 'palette-start',
        area: PALETTE_AREA,
        data: {
          action: 'grill-tab.start',
          detail: () => (composerAdapter.readDraft().trim() ? 'Interrogate the current draft' : 'Composer is empty'),
          id: 'grill-tab.start',
          keywords: ['grill', 'interrogate', 'draft'],
          label: 'Grill this draft',
          run: startFromComposer
        }
      },
      {
        id: 'start-keybind',
        area: KEYBINDS_AREA,
        data: {
          category: 'composer',
          defaults: ['mod+shift+g'],
          id: 'grill-tab.start',
          label: 'Grill this draft',
          run: startFromComposer
        }
      }
    ])
  }
}
