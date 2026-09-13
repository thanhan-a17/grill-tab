import assert from 'node:assert/strict'
import test from 'node:test'

import { fallbackBrief, initialGrillState, reduceGrill, shouldStartFromTab } from '../../desktop/grill-core.mjs'

test('state machine advances idle → asking → active → done → briefing → preview → idle', () => {
  let state = initialGrillState()
  state = reduceGrill(state, { type: 'START', intent: 'Ship a plugin' })
  assert.equal(state.status, 'asking')
  assert.equal(state.intent, 'Ship a plugin')

  state = reduceGrill(state, {
    type: 'INTERROGATION',
    response: { category: 'goal', done: false, options: ['A'], question: 'What outcome matters?', recommended: 'A usable plugin' }
  })
  assert.equal(state.status, 'active')
  assert.equal(state.current.question, 'What outcome matters?')

  state = reduceGrill(state, { type: 'COMMIT_ANSWER', answer: '' })
  assert.equal(state.status, 'asking')
  assert.deepEqual(state.ladder, [
    { answer: 'A usable plugin', category: 'goal', question: 'What outcome matters?', recommended: 'A usable plugin', settledFromRecommendation: false }
  ])

  state = reduceGrill(state, { type: 'INTERROGATION', response: { done: true, reason: 'Nothing critical left.' } })
  assert.equal(state.status, 'done')

  state = reduceGrill(state, { type: 'WRITE_BRIEF' })
  assert.equal(state.status, 'briefing')
  state = reduceGrill(state, { type: 'BRIEF_READY', brief: '## Goal\nShip it' })
  assert.equal(state.status, 'finalized')
  assert.equal(state.finalized, true)
  assert.equal(state.brief, '## Goal\nShip it')
  state = reduceGrill(state, { type: 'ESC' })
  assert.equal(state.status, 'finalized')
  state = reduceGrill(state, { type: 'RESET' })
  assert.equal(state.status, 'idle')
})

test('Esc, Backspace, and rung rollback preserve the editable prior answer', () => {
  const active = {
    answer: '',
    brief: '',
    current: { category: 'scope', options: [], question: 'What is excluded?', recommended: 'No dashboard changes' },
    escapeArmed: false,
    force: false,
    intent: 'Implement it',
    ladder: [
      { answer: 'A usable plugin', category: 'goal', question: 'What outcome?', recommended: 'A usable plugin', settledFromRecommendation: false },
      { answer: 'Desktop only', category: 'deliverable', question: 'Where?', recommended: 'Desktop only', settledFromRecommendation: false }
    ],
    reason: '',
    status: 'active'
  }

  const reopened = reduceGrill(active, { type: 'BACKSPACE_EMPTY' })
  assert.equal(reopened.current.question, 'Where?')
  assert.equal(reopened.answer, 'Desktop only')
  assert.equal(reopened.ladder.length, 1)

  const edited = reduceGrill(active, { type: 'REOPEN_RUNG', index: 0 })
  assert.equal(edited.editingIndex, 0)
  assert.deepEqual(edited.ladder, active.ladder)
  assert.equal(edited.current.question, active.current.question)

  const dismissed = reduceGrill(active, { type: 'ESC' })
  assert.equal(dismissed.status, 'active')
  assert.equal(dismissed.escapeArmed, true)
  const exited = reduceGrill(dismissed, { type: 'ESC' })
  assert.equal(exited.status, 'idle')
  assert.equal(exited.restoreIntent, 'Implement it')
})

test('checkpoint editing preserves later answers and saves only the selected rung', () => {
  const later = { answer: 'Desktop only', category: 'scope', question: 'Where?', recommended: 'Desktop only', settledFromRecommendation: true }
  const state = {
    ...initialGrillState(),
    current: { category: 'goal', options: [], question: 'What outcome?', recommended: 'A usable plugin' },
    ladder: [
      { answer: 'Original goal', category: 'goal', question: 'What outcome?', recommended: 'A usable plugin', settledFromRecommendation: true },
      later
    ],
    status: 'active'
  }

  const editing = reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 })
  assert.equal(editing.editingIndex, 0)
  assert.deepEqual(editing.ladder, state.ladder)

  const saved = reduceGrill(editing, { type: 'SAVE_CHECKPOINT', index: 0, answer: 'Updated goal' })
  assert.equal(saved.editingIndex, null)
  assert.deepEqual(saved.ladder, [
    { ...state.ladder[0], answer: 'Updated goal', settledFromRecommendation: false },
    later
  ])
  assert.deepEqual(saved.ladder[1], later)
})

test('removing a checkpoint preserves every other rung and adjusts an active edit index', () => {
  const ladder = [
    { answer: 'One', category: 'a', question: 'Q1', recommended: 'R1', settledFromRecommendation: false },
    { answer: 'Two', category: 'b', question: 'Q2', recommended: 'R2', settledFromRecommendation: false },
    { answer: 'Three', category: 'c', question: 'Q3', recommended: 'R3', settledFromRecommendation: false }
  ]
  const state = { ...initialGrillState(), ladder, editingIndex: 2, status: 'done' }
  const removed = reduceGrill(state, { type: 'REMOVE_CHECKPOINT', index: 0 })
  assert.deepEqual(removed.ladder, [ladder[1], ladder[2]])
  assert.equal(removed.editingIndex, 1)

  const removedEditing = reduceGrill(removed, { type: 'REMOVE_CHECKPOINT', index: 1 })
  assert.deepEqual(removedEditing.ladder, [ladder[1]])
  assert.equal(removedEditing.editingIndex, null)
})

test('checkpoint edits are blocked while briefing or after finalization', () => {
  const rung = { answer: 'Keep', category: 'goal', question: 'Q', recommended: 'R', settledFromRecommendation: false }
  for (const state of [
    { ...initialGrillState(), ladder: [rung], status: 'briefing' },
    { ...initialGrillState(), ladder: [rung], status: 'finalized', finalized: true },
    { ...initialGrillState(), ladder: [rung], status: 'done', finalized: true }
  ]) {
    const started = reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 })
    const saved = reduceGrill(state, { type: 'SAVE_CHECKPOINT', index: 0, answer: 'Changed' })
    const removed = reduceGrill(state, { type: 'REMOVE_CHECKPOINT', index: 0 })
    assert.deepEqual(started, state)
    assert.deepEqual(saved, state)
    assert.deepEqual(removed, state)
  }
})
test('WRITE_BRIEF on active question with empty answer does not adopt recommendation and only uses closed answers', () => {
  const ladder = [
    { answer: 'Ans 1', category: 'a', question: 'Q1', recommended: 'R1', settledFromRecommendation: false },
    { answer: 'Ans 2', category: 'b', question: 'Q2', recommended: 'R2', settledFromRecommendation: false },
    { answer: 'Ans 3', category: 'c', question: 'Q3', recommended: 'R3', settledFromRecommendation: false }
  ]
  const state = {
    ...initialGrillState(),
    answer: '',
    current: { category: 'd', options: [], question: 'Q4?', recommended: 'R4 default' },
    ladder,
    status: 'active'
  }

  // User hits enter without answering question 4
  const briefing = reduceGrill(state, { type: 'WRITE_BRIEF', answer: '', includeCurrent: true })
  assert.equal(briefing.status, 'briefing')
  assert.equal(briefing.current, null)
  assert.equal(briefing.ladder.length, 3, 'Ladder must only contain the 3 closed answers, not defaulting Q4')
  assert.deepEqual(briefing.ladder, ladder)
})

test('WRITE_BRIEF on active question with explicit answer commits that answer', () => {
  const ladder = [
    { answer: 'Ans 1', category: 'a', question: 'Q1', recommended: 'R1', settledFromRecommendation: false }
  ]
  const state = {
    ...initialGrillState(),
    answer: 'Explicit 2',
    current: { category: 'b', options: [], question: 'Q2?', recommended: 'R2 default' },
    ladder,
    status: 'active'
  }

  const briefing = reduceGrill(state, { type: 'WRITE_BRIEF', answer: 'Explicit 2', includeCurrent: true })
  assert.equal(briefing.status, 'briefing')
  assert.equal(briefing.ladder.length, 2)
  assert.equal(briefing.ladder[1].answer, 'Explicit 2')
})

test('end-to-end flow: checkpoint edit, auto-save, remove, later answer preservation, post-finalization edit blocking, composer replacement, and automatic close', () => {
  // Composer simulation
  let composerDraft = 'Build an offline sync tool'
  const fakeComposer = {
    readDraft: () => composerDraft,
    writeDraft: text => {
      composerDraft = text
      return true
    }
  }

  // 1. Start from composer
  let state = reduceGrill(initialGrillState(), { type: 'START', intent: fakeComposer.readDraft() })
  fakeComposer.writeDraft('')
  assert.equal(state.status, 'asking')
  assert.equal(state.intent, 'Build an offline sync tool')
  assert.equal(fakeComposer.readDraft(), '')

  // 2. Answer question 1
  state = reduceGrill(state, {
    type: 'INTERROGATION',
    response: { category: 'goal', done: false, options: [], question: 'What sync engine?', recommended: 'CRDT' }
  })
  state = reduceGrill(state, { type: 'COMMIT_ANSWER', answer: 'CRDT' })

  // 3. Answer question 2
  state = reduceGrill(state, {
    type: 'INTERROGATION',
    response: { category: 'scope', done: false, options: [], question: 'Which platforms?', recommended: 'Desktop only' }
  })
  state = reduceGrill(state, { type: 'COMMIT_ANSWER', answer: 'Desktop and Mobile' })

  // 4. Answer question 3
  state = reduceGrill(state, {
    type: 'INTERROGATION',
    response: { category: 'persistence', done: false, options: [], question: 'Storage format?', recommended: 'SQLite' }
  })
  state = reduceGrill(state, { type: 'COMMIT_ANSWER', answer: 'SQLite' })

  // Done status
  state = reduceGrill(state, { type: 'INTERROGATION', response: { done: true, reason: 'Nothing critical left.' } })
  assert.equal(state.status, 'done')
  assert.equal(state.ladder.length, 3)
  assert.equal(state.ladder[0].answer, 'CRDT')
  assert.equal(state.ladder[1].answer, 'Desktop and Mobile')
  assert.equal(state.ladder[2].answer, 'SQLite')

  // 5. Click previous checkpoint (rung 0) -> inline edit mode
  // "Clicking a previous checkpoint preserves all later answers."
  state = reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 })
  assert.equal(state.editingIndex, 0)
  assert.equal(state.ladder.length, 3)
  assert.equal(state.ladder[1].answer, 'Desktop and Mobile', 'Later answer 1 preserved')
  assert.equal(state.ladder[2].answer, 'SQLite', 'Later answer 2 preserved')

  // 6. Inline edits auto-save without a Save button and return to the ladder
  // "“Return to the ladder” means exit inline editing immediately after the change is committed."
  state = reduceGrill(state, { type: 'SAVE_CHECKPOINT', index: 0, answer: 'Event Sourcing' })
  assert.equal(state.editingIndex, null, 'Returned to the ladder')
  assert.equal(state.ladder[0].answer, 'Event Sourcing', 'Updated answer committed')
  assert.equal(state.ladder[1].answer, 'Desktop and Mobile', 'Later answer 1 preserved after save')
  assert.equal(state.ladder[2].answer, 'SQLite', 'Later answer 2 preserved after save')

  // 7. Remove checkpoint 1
  // "Removing a checkpoint preserves later answers and leaves the remaining ladder usable."
  state = reduceGrill(state, { type: 'REMOVE_CHECKPOINT', index: 1 })
  assert.equal(state.ladder.length, 2)
  assert.equal(state.ladder[0].answer, 'Event Sourcing')
  assert.equal(state.ladder[1].answer, 'SQLite', 'Later answer preserved after removal of earlier rung')
  assert.equal(state.editingIndex, null)

  // Verify remaining ladder is still usable for editing
  state = reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 1 })
  assert.equal(state.editingIndex, 1)
  state = reduceGrill(state, { type: 'SAVE_CHECKPOINT', index: 1, answer: 'IndexedDB' })
  assert.equal(state.ladder[1].answer, 'IndexedDB')
  assert.equal(state.editingIndex, null)

  // 8. Finalization & Post-finalization edit blocking
  // Enter pressed -> finalization begins
  state = reduceGrill(state, { type: 'WRITE_BRIEF' })
  assert.equal(state.status, 'briefing')

  // While briefing, edits must be blocked
  assert.deepEqual(reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 }), state)
  assert.deepEqual(reduceGrill(state, { type: 'SAVE_CHECKPOINT', index: 0, answer: 'No-op' }), state)
  assert.deepEqual(reduceGrill(state, { type: 'REMOVE_CHECKPOINT', index: 0 }), state)

  // Brief is ready
  const finalizedPrompt = fallbackBrief(state.intent, state.ladder)
  state = reduceGrill(state, { type: 'BRIEF_READY', brief: finalizedPrompt })
  assert.equal(state.status, 'finalized')
  assert.equal(state.finalized, true)

  // After finalization, edits must be blocked
  // "Checkpoints are editable only before finalization."
  // "Disable checkpoint editing after finalization."
  assert.deepEqual(reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 }), state)
  assert.deepEqual(reduceGrill(state, { type: 'SAVE_CHECKPOINT', index: 0, answer: 'No-op' }), state)
  assert.deepEqual(reduceGrill(state, { type: 'REMOVE_CHECKPOINT', index: 0 }), state)

  // 9. Composer replacement and automatic close
  // "After answering Grill questions and pressing Enter, the finalized prompt replaces the composer contents directly."
  // "Grill closes automatically after placing the prompt in the composer."
  fakeComposer.writeDraft(state.brief)
  state = reduceGrill(state, { type: 'RESET' })

  assert.equal(state.status, 'idle', 'Grill closed automatically')
  assert.ok(fakeComposer.readDraft().includes('## Goal\nBuild an offline sync tool'), 'Prompt replaced composer contents directly')
  assert.ok(fakeComposer.readDraft().includes('Event Sourcing'), 'Edited checkpoint reflected in finalized prompt')
  assert.ok(fakeComposer.readDraft().includes('IndexedDB'), 'Preserved later checkpoint reflected in finalized prompt')
  assert.ok(!fakeComposer.readDraft().includes('Desktop and Mobile'), 'Removed checkpoint excluded from finalized prompt')
})

test('checkpoint edit actions require a valid rung and editable status', () => {
  const state = {
    ...initialGrillState(),
    ladder: [{ answer: 'Keep', category: 'goal', question: 'Q', recommended: 'R', settledFromRecommendation: false }],
    status: 'active'
  }
  assert.deepEqual(reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: -1 }), state)
  assert.deepEqual(reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 1 }), state)
  const editing = reduceGrill(state, { type: 'START_EDIT_CHECKPOINT', index: 0 })
  assert.equal(editing.editingIndex, 0)
  const finalized = { ...editing, finalized: true, status: 'finalized' }
  assert.deepEqual(reduceGrill(finalized, { type: 'CANCEL_EDIT_CHECKPOINT' }), finalized)
})


test('Tab from done forces another interrogation and settled recommendation rewrites the last rung', () => {
  let state = {
    ...initialGrillState(),
    intent: 'Ship a plugin',
    ladder: [{ answer: 'You decide', category: 'goal', question: 'What outcome?', recommended: 'A usable plugin', settledFromRecommendation: false }],
    status: 'done'
  }
  state = reduceGrill(state, { type: 'FORCE_DONE' })
  assert.equal(state.status, 'asking')
  assert.equal(state.force, true)

  state = reduceGrill(state, {
    type: 'INTERROGATION',
    response: {
      category: 'scope',
      done: false,
      options: [],
      question: 'What is excluded?',
      recommended: 'No dashboard changes',
      settled_from_recommendation: true
    }
  })
  assert.equal(state.force, false)
  assert.equal(state.ladder[0].answer, 'A usable plugin')
  assert.equal(state.ladder[0].settledFromRecommendation, true)
  assert.equal(state.current.question, 'What is excluded?')
})

test('Tab gate only claims a plain Tab in an idle non-empty composer without a completion popover', () => {
  const target = { id: 'composer' }
  const env = {
    isComposerTarget: value => value === target,
    isPopoverOpen: () => false,
    readDraft: () => 'Draft intent',
    status: 'idle'
  }
  assert.equal(shouldStartFromTab({ altKey: false, ctrlKey: false, key: 'Tab', metaKey: false, shiftKey: false, target }, env), true)
  assert.equal(shouldStartFromTab({ altKey: false, ctrlKey: false, key: 'Tab', metaKey: false, shiftKey: true, target }, env), false)
  assert.equal(shouldStartFromTab({ altKey: false, ctrlKey: false, key: 'Tab', metaKey: false, shiftKey: false, target }, { ...env, readDraft: () => '  ' }), false)
  assert.equal(shouldStartFromTab({ altKey: false, ctrlKey: false, key: 'Tab', metaKey: false, shiftKey: false, target }, { ...env, isPopoverOpen: () => true }), false)
  assert.equal(shouldStartFromTab({ altKey: false, ctrlKey: false, key: 'Tab', metaKey: false, shiftKey: false, target }, { ...env, status: 'active' }), false)
})

test('fallback brief carries captured intent and settled directives without invented facts', () => {
  const brief = fallbackBrief('Implement the desktop half', [
    { answer: 'Drop-in plugin', category: 'deliverable', question: 'What should land?', recommended: 'Drop-in plugin', settledFromRecommendation: false }
  ])
  assert.equal(
    brief,
    '## Goal\nImplement the desktop half\n\n## Settled decisions\n- Deliverable — What should land?: Drop-in plugin\n\n## Assumptions to make explicitly (do not ask)\n- None captured in the ladder.\n\n## Directive\nWork autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief.'
  )
})
