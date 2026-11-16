import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_TOOLS, draftLink, isActionTool, proposeAction } from '../src/actions.ts'

const LEAD = 'c1661426-b627-43a8-b3fa-534bc6daf428'
const NOW = new Date('2026-11-15T18:00:00Z')

test('every action is a proposal tool, and only those', () => {
  assert.deepEqual(ACTION_TOOLS.map((t) => t.name), [
    'log_touch', 'set_next_action', 'record_outcome', 'set_owner', 'make_call_list', 'draft_message',
  ])
  for (const t of ACTION_TOOLS) assert.ok(isActionTool(t.name))
  assert.equal(isActionTool('find_people'), false)
})

test('log_touch calls the same endpoint the Log touch button uses', () => {
  const card = proposeAction('log_touch', { lead_id: LEAD, lead_name: 'Blythe', kind: 'call', note: 'no answer' })
  assert.ok(!('error' in card) && card.kind === 'request')
  assert.equal(card.request.path, `/api/fhl/leads/${LEAD}/touch`)
  assert.deepEqual(card.request.body, { kind: 'call', note: 'no answer' })
  assert.equal(card.title, 'Log a call with Blythe')
})

test('an action without a real lead id is refused, so the model looks it up first', () => {
  const card = proposeAction('log_touch', { lead_id: 'Blythe', kind: 'call' })
  assert.ok('error' in card)
})

test('lost needs a reason, and a competitor when it went to one', () => {
  assert.ok('error' in proposeAction('record_outcome', { lead_id: LEAD, outcome: 'lost' }))
  assert.ok('error' in proposeAction('record_outcome', { lead_id: LEAD, outcome: 'lost', reason: 'went_with_competitor' }))
  const ok = proposeAction('record_outcome', { lead_id: LEAD, lead_name: 'AJ', outcome: 'lost', reason: 'went_with_competitor', competitor: 'City Park' })
  assert.ok(!('error' in ok) && ok.kind === 'request')
  assert.equal(ok.request.path, `/api/fhl/leads/${LEAD}/outcome`)
})

test('booked warns that it reports the sale to Google Ads', () => {
  const card = proposeAction('record_outcome', { lead_id: LEAD, outcome: 'booked' })
  assert.ok(!('error' in card) && card.kind === 'request' && card.lines.some((l) => l.includes('Google Ads')))
})

test('next action: date becomes a working-hours due time; past dates refused', () => {
  const card = proposeAction('set_next_action', { lead_id: LEAD, note: 'call back', due_date: '2026-11-17' }, NOW)
  assert.ok(!('error' in card) && card.kind === 'request')
  assert.equal(card.request.body.dueAt, '2026-11-17T15:00:00.000Z')
  assert.ok('error' in proposeAction('set_next_action', { lead_id: LEAD, note: 'x', due_date: '2026-11-01' }, NOW))
})

test('a call list needs a filter, and uses the Make call list endpoint', () => {
  assert.ok('error' in proposeAction('make_call_list', { name: 'Everyone' }))
  const card = proposeAction('make_call_list', { name: 'Frisco quoted', city: 'Frisco', lifecycle: 'quoted' })
  assert.ok(!('error' in card) && card.kind === 'request')
  assert.deepEqual(card.request.body, { name: 'Frisco quoted', fromContacts: { lifecycle: 'quoted', city: 'Frisco' }, channels: ['call'] })
})

test('a message is a draft with a link for the user\'s own phone — never a send', () => {
  const card = proposeAction('draft_message', { channel: 'text', to_name: 'Blythe', to: '(870) 623-1061', body: 'Hi Blythe!', lead_id: LEAD })
  assert.ok(!('error' in card) && card.kind === 'draft')
  assert.equal(draftLink(card.draft), 'sms:8706231061?&body=Hi%20Blythe!')
  const mail = proposeAction('draft_message', { channel: 'email', to_name: 'B', to: 'b@x.com', subject: 'Hi', body: 'Yo' })
  assert.ok(!('error' in mail) && mail.kind === 'draft')
  assert.equal(draftLink(mail.draft), 'mailto:b%40x.com?subject=Hi&body=Yo')
})

test('a CSR is offered calls, next steps and drafts only', async () => {
  const { actionToolsFor } = await import('../src/actions.ts')
  assert.deepEqual(actionToolsFor('csr').map((t) => t.name).sort(), ['draft_message', 'log_touch', 'set_next_action'])
  assert.equal(actionToolsFor('owner').length, 6)
  assert.deepEqual(actionToolsFor('tech').map((t) => t.name), ['draft_message'])
})
