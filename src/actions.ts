// Ask Frosty's ACTIONS — what it can do, not just look up (owner, 2026-11-15:
// "make him agentic to take action").
//
// THE SAFETY MODEL, in one paragraph. Frosty never does anything itself. Each
// action tool only PROPOSES: it returns a card ("Log a call to Blythe — no
// answer") that the person sees with Confirm / Cancel (owner's choice: tap to
// confirm every action). On Confirm, the person's own browser calls the SAME
// platform endpoint the screens already use, with their own session, so every
// permission, validation and audit trail that applies to the button applies
// here. There is no new write path. Messages to customers are DRAFTS: the card
// lets them copy the text or open it in their own Messages / Mail app; nothing
// is sent by the platform.
//
// Pure: no I/O, no clock beyond what it is handed. No dependencies.

export interface ActionTool {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface RequestCard {
  kind: 'request'
  tool: string
  title: string
  lines: string[]
  request: { method: 'POST'; path: string; body: Record<string, unknown> }
  /** What to say once it worked. */
  done: string
}

export interface DraftCard {
  kind: 'draft'
  tool: string
  title: string
  lines: string[]
  draft: {
    channel: 'text' | 'email'
    toName: string
    to: string | null
    subject: string | null
    body: string
    leadId: string | null
  }
}

export type ActionCard = RequestCard | DraftCard

const TOUCH_KINDS = ['call', 'text', 'voicemail', 'email'] as const
const OUTCOMES = ['booked', 'lost', 'still_deciding'] as const
const LOST_REASONS = [
  'went_with_competitor',
  'we_dropped_them',
  'business_closed',
  'contact_changed',
  'price',
  'moved_or_sold',
  'no_longer_decorating',
  'other',
] as const
const OWNERS = ['frosty', 'fer'] as const
const LIFECYCLES = ['lead', 'quoted', 'customer', 'past_customer', 'lost', 'do_not_contact'] as const

const LEAD = { type: 'string', description: 'The lead_id from list_leads, quotes_waiting or find_people (lead_ids).' }
const NAME = { type: 'string', description: "The person's name, shown on the card." }

export const ACTION_TOOLS: ActionTool[] = [
  {
    name: 'log_touch',
    description:
      'PROPOSE logging a call, text, voicemail or email with a lead, with a short note. Shown to the user as a card; nothing happens until they tap Confirm.',
    input_schema: {
      type: 'object',
      properties: { lead_id: LEAD, lead_name: NAME, kind: { type: 'string', enum: [...TOUCH_KINDS] }, note: { type: 'string' } },
      required: ['lead_id', 'lead_name', 'kind'],
    },
  },
  {
    name: 'set_next_action',
    description:
      'PROPOSE setting the next action on a lead (what to do, optionally by a date YYYY-MM-DD). An empty note clears it. Confirm-first card.',
    input_schema: {
      type: 'object',
      properties: { lead_id: LEAD, lead_name: NAME, note: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD, optional' } },
      required: ['lead_id', 'lead_name', 'note'],
    },
  },
  {
    name: 'record_outcome',
    description:
      'PROPOSE recording how a lead ended: booked, lost (needs a reason; went_with_competitor needs the competitor) or still_deciding. Booked also reports the sale to Google Ads. Confirm-first card.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: LEAD,
        lead_name: NAME,
        outcome: { type: 'string', enum: [...OUTCOMES] },
        reason: { type: 'string', enum: [...LOST_REASONS] },
        competitor: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['lead_id', 'lead_name', 'outcome'],
    },
  },
  {
    name: 'set_owner',
    description: 'PROPOSE who owns a lead: frosty (the bot) or fer. Confirm-first card.',
    input_schema: {
      type: 'object',
      properties: { lead_id: LEAD, lead_name: NAME, owner: { type: 'string', enum: [...OWNERS] } },
      required: ['lead_id', 'lead_name', 'owner'],
    },
  },
  {
    name: 'make_call_list',
    description:
      'PROPOSE making a call list (a calls-only campaign) from the Master Marketing List, filtered by any of: lifecycle, city, zip, search text, lost_reason, segment key. At least one filter. Confirm-first card.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        lifecycle: { type: 'string', enum: [...LIFECYCLES] },
        city: { type: 'string' },
        zip: { type: 'string' },
        search: { type: 'string' },
        lost_reason: { type: 'string', enum: [...LOST_REASONS] },
        segment: { type: 'string', description: 'A saved-list key, if the user named one.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'draft_message',
    description:
      'WRITE a text or email for the user to send from their own phone or mail. Shown as a card with Copy / Open in Messages / Open in Mail; the platform sends nothing. Include lead_id when it is for a lead so the user can log it as sent.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['text', 'email'] },
        to_name: { type: 'string' },
        to: { type: 'string', description: 'Phone for a text, email address for an email.' },
        subject: { type: 'string' },
        body: { type: 'string' },
        lead_id: { type: 'string' },
      },
      required: ['channel', 'to_name', 'body'],
    },
  },
]

const ACTION_NAMES = new Set(ACTION_TOOLS.map((t) => t.name))

export function isActionTool(name: string): boolean {
  return ACTION_NAMES.has(name)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function str(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null
}

const human = (key: string) => key.replace(/_/g, ' ')

/**
 * Turn a proposal into a card, or say why it cannot be one. The error goes
 * back to the model so it can fix the call (usually: look the lead up first).
 */
export function proposeAction(name: string, input: Record<string, unknown>, now: Date = new Date()): ActionCard | { error: string } {
  const leadId = str(input.lead_id, 60)
  const who = str(input.lead_name, 80) ?? 'this lead'
  const needLead = () => (leadId && UUID.test(leadId) ? null : { error: 'lead_id must be a real lead id — look the lead up first' })

  if (name === 'log_touch') {
    const bad = needLead()
    if (bad) return bad
    const kind = oneOf(input.kind, TOUCH_KINDS)
    if (!kind) return { error: 'kind must be call, text, voicemail or email' }
    const note = str(input.note, 500)
    return {
      kind: 'request',
      tool: name,
      title: `Log a ${kind} with ${who}`,
      lines: note ? [`Note: ${note}`] : [],
      request: { method: 'POST', path: `/api/fhl/leads/${leadId}/touch`, body: { kind, note } },
      done: `Logged the ${kind} with ${who}.`,
    }
  }

  if (name === 'set_next_action') {
    const bad = needLead()
    if (bad) return bad
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 280) : ''
    const date = str(input.due_date, 10)
    let dueAt: string | null = null
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'due_date must be YYYY-MM-DD' }
      // 9am Dallas (15:00 UTC in winter, 10am in summer) — a working-hours due time.
      dueAt = `${date}T15:00:00.000Z`
      if (Date.parse(dueAt) < now.getTime()) return { error: 'due_date is in the past' }
    }
    return {
      kind: 'request',
      tool: name,
      title: note ? `Next action for ${who}` : `Clear the next action for ${who}`,
      lines: [note ? `“${note}”` : 'Hands the line back to the system.', ...(date ? [`Due ${date}`] : [])],
      request: { method: 'POST', path: `/api/fhl/pipeline/leads/${leadId}/next-action`, body: { note, dueAt } },
      done: note ? `Next action set for ${who}.` : `Cleared ${who}'s next action.`,
    }
  }

  if (name === 'record_outcome') {
    const bad = needLead()
    if (bad) return bad
    const outcome = oneOf(input.outcome, OUTCOMES)
    if (!outcome) return { error: 'outcome must be booked, lost or still_deciding' }
    const reason = oneOf(input.reason, LOST_REASONS)
    if (outcome === 'lost' && !reason) return { error: `a lost lead needs a reason: ${LOST_REASONS.join(', ')}` }
    const competitor = str(input.competitor, 120)
    if (reason === 'went_with_competitor' && !competitor) return { error: 'went_with_competitor needs the competitor name' }
    const note = str(input.note, 500)
    const lines = [
      ...(reason ? [`Reason: ${human(reason)}${competitor ? ` (${competitor})` : ''}`] : []),
      ...(note ? [`Note: ${note}`] : []),
      ...(outcome === 'booked' ? ['Also reports the sale to Google Ads.'] : []),
    ]
    return {
      kind: 'request',
      tool: name,
      title: `Mark ${who} as ${human(outcome)}`,
      lines,
      request: { method: 'POST', path: `/api/fhl/leads/${leadId}/outcome`, body: { outcome, reason, competitor, note } },
      done: `${who} marked ${human(outcome)}.`,
    }
  }

  if (name === 'set_owner') {
    const bad = needLead()
    if (bad) return bad
    const owner = oneOf(input.owner, OWNERS)
    if (!owner) return { error: 'owner must be frosty or fer' }
    return {
      kind: 'request',
      tool: name,
      title: `Give ${who} to ${owner === 'fer' ? 'Fer' : 'Frosty (the bot)'}`,
      lines: [],
      request: { method: 'POST', path: `/api/fhl/pipeline/leads/${leadId}/owner`, body: { owner } },
      done: `${who} now belongs to ${owner === 'fer' ? 'Fer' : 'Frosty'}.`,
    }
  }

  if (name === 'make_call_list') {
    const listName = str(input.name, 80)
    if (!listName) return { error: 'the call list needs a name' }
    const fromContacts: Record<string, unknown> = {}
    const lifecycle = oneOf(input.lifecycle, LIFECYCLES)
    if (lifecycle) fromContacts.lifecycle = lifecycle
    for (const [k, v] of [['city', input.city], ['zip', input.zip], ['search', input.search], ['segment', input.segment]] as const) {
      const val = str(v, 120)
      if (val) fromContacts[k] = val
    }
    const lostReason = oneOf(input.lost_reason, LOST_REASONS)
    if (lostReason) fromContacts.lostReason = lostReason
    if (Object.keys(fromContacts).length === 0) return { error: 'pick at least one filter — a call list to everybody is not a list' }
    return {
      kind: 'request',
      tool: name,
      title: `Make a call list: ${listName}`,
      lines: Object.entries(fromContacts).map(([k, v]) => `${human(k)}: ${String(v)}`),
      request: { method: 'POST', path: '/api/fhl/campaigns', body: { name: listName, fromContacts, channels: ['call'] } },
      done: `Made the call list “${listName}”. It is under Marketing → Campaigns.`,
    }
  }

  if (name === 'draft_message') {
    const channel = oneOf(input.channel, ['text', 'email'] as const)
    if (!channel) return { error: 'channel must be text or email' }
    const body = str(input.body, 2000)
    if (!body) return { error: 'the message has no body' }
    const toName = str(input.to_name, 80) ?? 'them'
    const lid = str(input.lead_id, 60)
    return {
      kind: 'draft',
      tool: name,
      title: `${channel === 'text' ? 'Text' : 'Email'} to ${toName}`,
      lines: [],
      draft: {
        channel,
        toName,
        to: str(input.to, 120),
        subject: channel === 'email' ? str(input.subject, 160) : null,
        body,
        leadId: lid && UUID.test(lid) ? lid : null,
      },
    }
  }

  return { error: `unknown action ${name}` }
}

/** sms: / mailto: link for a draft, opened on the user's own device. */
export function draftLink(d: DraftCard['draft']): string | null {
  if (!d.to) return null
  if (d.channel === 'text') {
    const phone = d.to.replace(/[^\d+]/g, '')
    return phone ? `sms:${phone}?&body=${encodeURIComponent(d.body)}` : null
  }
  const q = [d.subject ? `subject=${encodeURIComponent(d.subject)}` : null, `body=${encodeURIComponent(d.body)}`].filter(Boolean).join('&')
  return `mailto:${encodeURIComponent(d.to)}?${q}`
}
