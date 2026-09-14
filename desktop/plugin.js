import {
  atom,
  COMPOSER_AREAS,
  CopyButton,
  GlyphSpinner,
  host,
  Kbd,
  KbdGroup,
  KEYBINDS_AREA,
  PALETTE_AREA,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef } from 'react'

const ID = 'grill-tab'

// @core-start
export function initialGrillState() {
  return {
    answer: '',
    attachments: [],
    brief: '',
    current: null,
    escapeArmed: false,
    force: false,
    intent: '',
    ladder: [],
    reason: '',
    restoreIntent: '',
    editingIndex: null,
    finalized: false,
    sessionHistory: [],
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

function validCheckpointIndex(state, index) {
  return Number.isInteger(index) && index >= 0 && index < state.ladder.length
}

function canEditCheckpoint(state, index) {
  return !state.finalized && ['active', 'done'].includes(state.status) && validCheckpointIndex(state, index)
}

function canStartCheckpointEdit(state, index) {
  return !state.finalized && ['active', 'done'].includes(state.status) && validCheckpointIndex(state, index)
}

export function reduceGrill(state, action) {
  switch (action.type) {
    case 'START':
      return {
        ...initialGrillState(),
        attachments: Array.isArray(action.attachments) ? action.attachments : [],
        intent: action.intent,
        sessionHistory: Array.isArray(action.sessionHistory) ? action.sessionHistory : [],
        status: 'asking'
      }
    case 'SET_SESSION_HISTORY':
      return { ...state, sessionHistory: Array.isArray(action.sessionHistory) ? action.sessionHistory : [] }
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
      const hasExplicitAnswer = Boolean(action.answer && String(action.answer).trim())
      const next = (action.includeCurrent && hasExplicitAnswer)
        ? withCommittedCurrent(state, String(action.answer).trim())
        : { ...state, current: null, answer: '' }
      return { ...next, status: 'briefing' }
    }
    case 'BRIEF_READY':
      return state.status === 'briefing'
        ? { ...state, brief: action.brief || '', finalized: true, status: 'finalized' }
        : state
    case 'START_EDIT_CHECKPOINT':
      return canStartCheckpointEdit(state, action.index) ? { ...state, editingIndex: action.index } : state
    case 'CANCEL_EDIT_CHECKPOINT':
      return canEditCheckpoint(state, state.editingIndex) ? { ...state, editingIndex: null } : state
    case 'SAVE_CHECKPOINT':
      return canEditCheckpoint(state, action.index)
        ? {
            ...state,
            editingIndex: null,
            ladder: state.ladder.map((rung, index) =>
              index === action.index ? { ...rung, answer: action.answer, settledFromRecommendation: false } : rung
            )
          }
        : state
    case 'REMOVE_CHECKPOINT':
      if (!canEditCheckpoint(state, action.index)) return state
      return {
        ...state,
        editingIndex: state.editingIndex === action.index
          ? null
          : state.editingIndex > action.index
            ? state.editingIndex - 1
            : state.editingIndex,
        ladder: state.ladder.filter((_, index) => index !== action.index)
      }
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
    case 'REOPEN_RUNG':
      return canEditCheckpoint(state, action.index)
        ? { ...state, editingIndex: action.index }
        : state
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

  readAttachments() {
    const attachmentState = host.state?.composerAttachments?.get?.() ?? globalThis.__HERMES_PLUGIN_SDK__?.$composerAttachments?.get?.()
    if (Array.isArray(attachmentState)) return attachmentState
    const root = this.getRoot() || document
    return [...root.querySelectorAll('[data-slot="composer-attachments"] [data-attachment], [data-slot="composer-attachments"] > *')]
      .map((element, index) => {
        const image = element.querySelector?.('img')
        const name = element.getAttribute?.('data-name') || image?.getAttribute('alt') || element.textContent?.trim() || `Attachment ${index + 1}`
        return {
          id: element.getAttribute?.('data-id') || `${name}-${index}`,
          kind: image ? 'image' : 'file',
          name,
          data_url: image?.getAttribute('src') || undefined,
          path: element.getAttribute?.('data-path') || undefined,
          size: Number(element.getAttribute?.('data-size')) || undefined
        }
      })
  },

  forwardAttachments(attachments) {
    const payload = Array.isArray(attachments) ? attachments : []
    const attachmentState = host.state?.composerAttachments ?? globalThis.__HERMES_PLUGIN_SDK__?.$composerAttachments
    if (attachmentState?.set) attachmentState.set(payload)
    return payload
  },

  readSessionHistory() {
    const messages = host.state?.messages?.get?.() ?? globalThis.__HERMES_PLUGIN_SDK__?.$messages?.get?.()
    if (Array.isArray(messages)) {
      return messages
        .map(message => ({ role: message?.role, content: message?.content ?? message?.text ?? '' }))
        .filter(message => ['user', 'assistant', 'system'].includes(message.role) && String(message.content).trim())
        .map(message => ({ ...message, content: String(message.content) }))
    }
    return [...document.querySelectorAll('[data-slot="aui_user-message-root"], [data-slot="aui_assistant-message-content"]')]
      .map(element => ({
        role: element.matches('[data-slot="aui_user-message-root"]') ? 'user' : 'assistant',
        content: element.textContent?.trim() || ''
      }))
      .filter(message => message.content)
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
        attachments: state.attachments,
        cwd: host.state.cwd.get() ?? null,
        force: Boolean(state.force),
        ladder: contractLadder(state.ladder),
        profile: host.state.profile.get() ?? null,
        session_history: state.sessionHistory,
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
  const attachments = composerAdapter.readAttachments()
  const sessionHistory = composerAdapter.readSessionHistory()
  if (!composerAdapter.writeDraft('')) {
    host.notify({ kind: 'error', message: 'Could not clear the composer for grilling.' })
    return
  }
  update({ type: 'START', attachments, intent, sessionHistory })
  void askNext()
}

function commitAnswer(answer = $grill.get().answer) {
  const state = $grill.get()
  if (state.status !== 'active') return
  update({ type: 'COMMIT_ANSWER', answer })
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
        attachments: requestState.attachments,
        cwd: host.state.cwd.get() ?? null,
        ladder: contractLadder(requestState.ladder),
        profile: host.state.profile.get() ?? null,
        session_history: requestState.sessionHistory,
        text: requestState.intent
      }
    })
    if (serial !== requestSerial) return
    const brief = typeof response?.brief === 'string' && response.brief.trim()
      ? response.brief
      : fallbackBrief(requestState.intent, requestState.ladder)
    update({ type: 'BRIEF_READY', brief })
    if (!composerAdapter.writeDraft(brief)) host.notify({ kind: 'error', message: 'Could not write the brief into the composer.' })
    composerAdapter.forwardAttachments(requestState.attachments)
    update({ type: 'RESET' })
  } catch (error) {
    if (serial !== requestSerial) return
    host.notifyError(error, 'Brief model unavailable; using the local template.')
    const brief = fallbackBrief(requestState.intent, requestState.ladder)
    update({ type: 'BRIEF_READY', brief })
    if (!composerAdapter.writeDraft(brief)) host.notify({ kind: 'error', message: 'Could not write the brief into the composer.' })
    composerAdapter.forwardAttachments(requestState.attachments)
    update({ type: 'RESET' })
  }
}

async function launchBrief() {
  const state = $grill.get()
  if (state.status !== 'preview' || !state.brief) return
  if (!composerAdapter.writeDraft(state.brief)) {
    host.notify({ kind: 'error', message: 'Could not write the brief into the composer.' })
    return
  }
  requestSerial += 1
  update({ type: 'RESET' })
}

function restoreIntentAndReset(intent = $grill.get().intent) {
  requestSerial += 1
  if (intent && !composerAdapter.writeDraft(intent)) {
    host.notify({ kind: 'error', message: 'Could not restore the intent into the composer.' })
    return
  }
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

const typeStyle = { color: 'var(--ui-text-secondary)', fontFamily: 'var(--dt-font-sans, inherit)' }
const monoStyle = { color: 'var(--ui-text-quaternary)', fontFamily: 'var(--dt-font-mono, monospace)' }
// Settled rows recede so the live question can be plain primary text without a size jump.
const PAST_OPACITY = 0.55
// Answer line: quiet stroke at rest, accent on focus (approved look).
const INPUT_LINE = 'var(--ui-stroke-secondary)'
const INPUT_LINE_FOCUS = 'var(--ui-accent)'

function HintRow({ done = false }) {
  return jsxs('div', {
    'data-grill': 'hints',
    'data-grill-hints': true,
    style: { ...typeStyle, alignItems: 'center', display: 'flex', flexWrap: 'wrap', fontSize: '11px', gap: '6px', lineHeight: '16px' },
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

function CheckpointEditor({ rung, index }) {
  const inputRef = useRef(null)
  const committedRef = useRef(false)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [])
  const commit = event => {
    if (committedRef.current) return
    committedRef.current = true
    update({ type: 'SAVE_CHECKPOINT', index, answer: event.currentTarget.value })
  }
  const cancel = event => {
    if (committedRef.current) return
    committedRef.current = true
    update({ type: 'CANCEL_EDIT_CHECKPOINT' })
    event.preventDefault()
    event.stopPropagation()
  }
  return jsxs('div', {
    'data-grill': 'checkpoint-editor',
    'data-grill-checkpoint-editor': true,
    style: { display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: '20px minmax(0, 1fr) auto', rowGap: '4px' },
    children: [
      jsx('span', { 'data-grill-rung-number': true, style: { ...monoStyle, fontSize: '12px' }, children: String(index + 1).padStart(2, '0') }),
      jsx('span', { 'data-grill-checkpoint-question': true, style: { ...typeStyle, fontSize: '12px', lineHeight: '16px' }, children: rung.question }),
      jsx('button', {
        'aria-label': `Remove checkpoint ${index + 1}`,
        'data-grill': 'checkpoint-remove',
        'data-grill-checkpoint-remove': true,
        onClick: event => {
          event.preventDefault()
          event.stopPropagation()
          update({ type: 'REMOVE_CHECKPOINT', index })
        },
        onMouseDown: event => event.preventDefault(),
        style: { ...typeStyle, background: 'transparent', border: 0, cursor: 'pointer', fontSize: '11px', padding: '0 0 0 8px' },
        type: 'button',
        children: 'Remove'
      }),
      jsx('input', {
        'aria-label': `Edit checkpoint ${index + 1}`,
        'data-grill': 'checkpoint-input',
        'data-grill-checkpoint-input': true,
        defaultValue: rung.answer,
        onBlur: commit,
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            commit(event)
          } else if (event.key === 'Escape') {
            cancel(event)
          }
        },
        ref: inputRef,
        style: { ...typeStyle, background: 'transparent', border: 0, borderBottom: `1px solid ${INPUT_LINE}`, borderRadius: 0, boxSizing: 'border-box', fontSize: '13px', gridColumn: '2 / -1', lineHeight: '20px', outline: 'none', padding: '6px 0', width: '100%' }
      })
    ]
  })
}

function Ladder({ ladder, editingIndex, canEdit }) {
  if (!ladder.length) return null
  return jsx('div', {
    'data-grill-ladder': true,
    style: { display: 'grid', marginTop: '16px', rowGap: '8px' },
    children: ladder.map((rung, index) => editingIndex === index && canEdit
      ? jsx(CheckpointEditor, { index, key: `${rung.question}-${index}`, rung })
      : jsxs('button', {
          'aria-disabled': !canEdit,
          className: 'grill-rung-enter',
          'data-grill': 'rung',
          'data-grill-rung': true,
          disabled: !canEdit,
          key: `${rung.question}-${index}`,
          onClick: () => { if (canEdit) update({ type: 'START_EDIT_CHECKPOINT', index }) },
          style: {
            ...typeStyle,
            alignItems: 'baseline',
            background: 'transparent',
            border: 0,
            cursor: canEdit ? 'pointer' : 'default',
            display: 'grid',
            gridTemplateColumns: '20px minmax(0, 1fr) minmax(0, 0.8fr)',
            lineHeight: '16px',
            minWidth: 0,
            opacity: PAST_OPACITY,
            padding: 0,
            textAlign: 'left',
            width: '100%'
          },
          type: 'button',
          children: [
            jsx('span', { 'data-grill-rung-number': true, style: { ...monoStyle, fontSize: '12px' }, children: String(index + 1).padStart(2, '0') }),
            jsx('span', { 'data-grill-rung-text': true, style: { fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: rung.question, children: rung.question }),
            jsx(Tip, {
              label: rung.answer,
              children: jsx('span', {
                'data-grill-rung-answer': true,
                style: { color: 'var(--ui-text-primary, inherit)', fontSize: '12px', minWidth: 0, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                children: `${rung.answer}${rung.settledFromRecommendation ? ' (recommended)' : ''}`
              })
            })
          ]
        })
    )
  })
}

function CurrentQuestion({ number, text }) {
  return jsxs('div', {
    className: 'grill-question-enter',
    'data-grill': 'question',
    'data-grill-current-question': true,
    style: { alignItems: 'baseline', display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', lineHeight: '20px' },
    children: [
      jsx('span', { 'data-grill-current-number': true, style: { ...monoStyle, fontSize: '12px' }, children: String(number).padStart(2, '0') }),
      jsx('span', { 'data-grill-current-text': true, style: { color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '14px', fontWeight: 500 }, children: text })
    ]
  })
}

function ActiveQuestion({ state }) {
  const current = state.current
  const nextNumber = state.ladder.length + 1
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
      style: { background: 'transparent', border: 0, cursor: 'pointer', marginTop: '16px', padding: 0, textAlign: 'left', width: '100%' },
      type: 'button',
      children: jsx(CurrentQuestion, { number: nextNumber, text: 'Question dismissed. Press Esc again to restore the intent.' })
    })
  }
  const recommendation = String(current.recommended || '').trim().toLocaleLowerCase()
  const options = current.options.filter(option => String(option).trim().toLocaleLowerCase() !== recommendation)
  return jsxs('div', {
    style: { marginTop: '16px' },
    children: [
      jsx(CurrentQuestion, { key: `${nextNumber}-${current.question}`, number: nextNumber, text: current.question }),
      jsx('input', {
        'aria-label': 'Grill answer',
        'data-grill': 'input',
        'data-grill-answer-input': true,
        autoFocus: true,
        onBlur: event => { event.currentTarget.style.borderColor = INPUT_LINE },
        onChange: event => update({ type: 'SET_ANSWER', answer: event.currentTarget.value }),
        onFocus: event => { event.currentTarget.style.borderColor = INPUT_LINE_FOCUS },
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
            if (state.ladder.length) update({ type: 'BACKSPACE_EMPTY' })
            else restoreIntentAndReset()
          }
        },
        placeholder: current.recommended ? `recommended: ${current.recommended}` : 'Answer this decision',
        style: {
          ...typeStyle,
          background: 'transparent',
          border: 0,
          borderBottom: `1px solid ${INPUT_LINE}`,
          borderRadius: 0,
          boxSizing: 'border-box',
          fontSize: '13px',
          lineHeight: '20px',
          marginTop: '8px',
          outline: 'none',
          padding: '6px 0',
          width: '100%'
        },
        value: state.answer
      }),
      options.length
        ? jsx('div', {
            'data-grill': 'chips',
            'data-grill-chips': true,
            style: { ...typeStyle, columnGap: '16px', display: 'flex', flexWrap: 'wrap', fontSize: '12px', marginTop: '8px', rowGap: '6px' },
            children: options.map((option, index) => jsx('button', {
              'data-grill-chip': true,
              key: `${option}-${index}`,
              onClick: () => commitAnswer(option),
              style: { ...typeStyle, background: 'transparent', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', lineHeight: '16px', padding: '2px 8px' },
              onMouseEnter: event => { event.currentTarget.style.borderColor = 'var(--ui-accent)'; event.currentTarget.style.color = 'var(--ui-text-primary, inherit)' },
              onMouseLeave: event => { event.currentTarget.style.borderColor = 'var(--ui-stroke-secondary)'; event.currentTarget.style.color = 'var(--ui-text-secondary)' },
              type: 'button',
              children: option
            }))
          })
        : null,
      jsx('div', { style: { marginTop: options.length ? '12px' : '12px' }, children: jsx(HintRow, {}) })
    ]
  })
}

function DoneRow({ state }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return jsxs('div', {
    'data-grill': 'done',
    style: { marginTop: '16px' },
    children: [
      jsx(CurrentQuestion, { number: state.ladder.length + 1, text: 'Nothing critical left.' }),
      jsx('button', {
        ref,
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
                        event.stopPropagation()
                        restoreIntentAndReset()
                      }
                    },
                    style: { background: 'transparent', border: 0, cursor: 'pointer', marginTop: '12px', padding: 0, textAlign: 'left' },
                    type: 'button',
                    children: jsx(HintRow, { done: true })
                  })
                ]
              })
}

function Preview({ state }) {
  // `autoFocus` is unreliable on a div — the composer keeps focus and its own
  // Enter handler submits the (empty) draft. Take focus explicitly on mount.
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return jsxs('div', {
    ref,
    className: 'grill-brief-reveal',
    'data-grill': 'preview',
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
        'data-grill-preview-text': true,
        style: { color: 'var(--ui-text-primary, inherit)', fontFamily: 'var(--dt-font-sans, inherit)', fontSize: '12px', lineHeight: '18px', maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' },
        children: state.brief
      }),
      jsxs('div', {
        'data-grill-preview-hints': true,
        style: { ...typeStyle, alignItems: 'center', display: 'flex', fontSize: '11px', gap: '6px', marginTop: '12px' },
        children: [
          jsx(Kbd, { children: 'Enter', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'place in composer ·' }),
          jsx(Kbd, { children: 'Esc', size: 'sm', variant: 'ghost' }),
          jsx('span', { children: 'back' }),
          jsx(CopyButton, { appearance: 'icon', buttonSize: 'icon', className: 'size-6', label: 'Copy brief', text: state.brief })
        ]
      })
    ]
  })
}

function LoadingRow({ children }) {
  return jsxs('div', {
    style: { alignItems: 'center', display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', marginTop: '16px' },
    children: [
      jsx('span', { style: { ...monoStyle, fontSize: '10px', lineHeight: '16px' }, children: jsx(GlyphSpinner, { ariaLabel: 'Loading' }) }),
      jsx('span', { 'data-grill-loading-text': true, style: { ...typeStyle, fontSize: '14px', fontWeight: 500, lineHeight: '20px' }, children })
    ]
  })
}

function GrillMotionStyles() {
  return jsx('style', {
    children: `
      @keyframes grillFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes grillRungEnter { from { opacity: 0; transform: translateY(6px); } to { opacity: ${PAST_OPACITY}; transform: translateY(0); } }
      @keyframes grillBriefReveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .grill-question-enter { animation: grillFadeIn 180ms cubic-bezier(.22,.8,.2,1) both; }
      .grill-rung-enter { animation: grillRungEnter 220ms cubic-bezier(.22,.8,.2,1) both; }
      .grill-brief-reveal { animation: grillBriefReveal 260ms cubic-bezier(.22,.8,.2,1) both; }
      @media (prefers-reduced-motion: reduce) { .grill-question-enter, .grill-rung-enter, .grill-brief-reveal { animation-duration: 1ms; } }
    `
  })
}

function GrillLadder() {
  const state = useValue($grill)
  if (state.status === 'idle') return null
  const canEdit = !state.finalized && ['active', 'done'].includes(state.status)
  const body =
    state.status === 'asking'
      ? jsx(LoadingRow, { children: 'Finding the next decision…' })
      : state.status === 'briefing'
        ? jsx(LoadingRow, { children: 'Writing the brief…' })
        : state.status === 'active'
          ? jsx(ActiveQuestion, { state })
          : state.status === 'done'
            ? jsx(DoneRow, { state })
            : jsx(Preview, { state })

  return jsxs('div', {
    'data-grill-strip': true,
    style: { padding: '0 0 8px' },
    children: [
      jsx(GrillMotionStyles, {}),
      jsxs('div', {
        'data-grill': 'header',
        'data-grill-intent-row': true,
        style: { alignItems: 'baseline', display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', lineHeight: '16px', minWidth: 0, opacity: PAST_OPACITY },
        children: [
          jsx('span', { 'data-grill-intent-label': true, 'aria-hidden': true, style: { ...monoStyle, fontSize: '12px' }, children: '—' }),
          jsx('span', { 'data-grill-intent-text': true, style: { ...typeStyle, fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: state.intent, children: state.intent })
        ]
      }),
      jsx(Ladder, {
        canEdit,
        editingIndex: state.editingIndex,
        ladder: state.ladder
      }),
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
        // While a ladder is open the composer is intentionally empty; an Enter
        // that reaches the app's submit path anyway must not fire a blank turn.
        data: { handler: draft => ($grill.get().status !== 'idle' ? null : draft) }
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
