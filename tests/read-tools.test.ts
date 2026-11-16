import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_TOOLS, runAskTool } from '../src/read-tools.ts'

function fakeDb(rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'or', 'order', 'limit', 'neq', 'in']) q[m] = () => q
  q.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null })
  return { from: () => q }
}
const NOW = new Date('2026-11-15T18:00:00Z')

test('read tools are the six look-ups', () => {
  assert.deepEqual(ASK_TOOLS.map((t) => t.name), ['find_people', 'person_story', 'list_leads', 'quotes_waiting', 'pipeline_numbers', 'money'])
})

test('quotes_waiting: oldest first, with lead_id, no approved/designer rows', async () => {
  const out = (await runAskTool(fakeDb([
    { id: 'a', first_name: 'Old', jobber_quote_sent_at: '2026-11-01T00:00:00Z', created_at: '2026-10-30T00:00:00Z' },
    { id: 'b', first_name: 'New', jobber_quote_sent_at: '2026-11-10T00:00:00Z', created_at: '2026-11-09T00:00:00Z' },
    { id: 'c', first_name: 'Won', jobber_quote_sent_at: '2026-11-01T00:00:00Z', jobber_quote_approved_at: '2026-11-02T00:00:00Z', created_at: '2026-10-30T00:00:00Z' },
    { id: 'd', first_name: 'Practice', jobber_quote_sent_at: '2026-11-01T00:00:00Z', created_at: '2026-10-30T00:00:00Z', source: 'designer' },
  ]), 'org', 'quotes_waiting', {}, NOW)) as { waiting: { lead_id: string; name: string }[] }
  assert.deepEqual(out.waiting.map((w) => [w.lead_id, w.name]), [['a', 'Old'], ['b', 'New']])
})
