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
    editingIndex: null,
    finalized: false,
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
