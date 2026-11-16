// Ask Frosty's lookups — what turns it from a document reader into a desk
// assistant (owner, 2026-11-15: "Frosty isn't any help … it should be of
// extreme help").
//
// Every tool is a READ, run with the CALLER'S Supabase client so RLS applies
// exactly as it does on the screens they already see. Nothing here writes,
// sends or changes anything. Test leads never count. Results are trimmed to
// what a desk answer needs.

// No dependencies: the platform passes its own Supabase client in. This is the
// one structural shape the tools use, so the repo can be tested on its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = { from: (table: string) => any }

export interface AskTool {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export const ASK_TOOLS: AskTool[] = [
  {
    name: 'find_people',
    description:
      'Find people on the Master Marketing List by name, street, city, email or phone. Returns their contact id (for person_story), lead_ids (for actions), stage, contact details, address, jobs, lifetime spend and last quote.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'person_story',
    description: 'Everything that happened with one person, newest first: leads, quotes sent/opened/approved, jobs, payments, messages. Takes a contact id from find_people.',
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' } }, required: ['contact_id'] },
  },
  {
    name: 'list_leads',
    description:
      'Leads that came in during the last N days (default 7), newest first, with source, budget band, address, phone, whether quoted, opened and approved. Optional: only_unquoted, from_ads.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number' },
        only_unquoted: { type: 'boolean' },
        from_ads: { type: 'boolean' },
      },
    },
  },
  {
    name: 'quotes_waiting',
    description:
      'Quotes that were sent and have NOT been approved: who, phone, total, budget band they gave, when sent, whether and when they opened it, days waiting. The follow-up list. Optional min_days (default 3).',
    input_schema: { type: 'object', properties: { min_days: { type: 'number' } } },
  },
  {
    name: 'pipeline_numbers',
    description:
      'Counts for the last N days (default 7): leads, from ads, quoted, opened, approved, close rate, average quote, by source and by budget band.',
    input_schema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'money',
    description: 'Money by season: quoted, accepted, collected and outstanding, and the biggest houses. Optional season year (default: this season).',
    input_schema: { type: 'object', properties: { season: { type: 'number' } } },
  },
]

const LEAD_COLUMNS =
  'id, first_name, last_name, phone, email, address, city, zip, source, status, created_at, quoted_at, ' +
  'jobber_quote_sent_at, jobber_quote_viewed_at, jobber_quote_approved_at, jobber_quote_total_cents, won_at, ' +
  'outcome, lost_reason, gclid, gbraid, wbraid, details, next_action_note, is_test'

type Row = Record<string, unknown>

function dollars(cents: unknown): string | null {
  const n = Number(cents)
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n / 100).toLocaleString('en-US')}` : null
}

function daysSince(iso: unknown, now: Date): number | null {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : null
}

function leadView(r: Row, now: Date) {
  const d = (r.details ?? {}) as Row
  return {
    lead_id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: [r.address, r.city, r.zip].filter(Boolean).join(', ') || null,
    came_in: r.created_at,
    from_ads: Boolean(r.gclid || r.gbraid || r.wbraid),
    source: r.source,
    budget: (d.budget as string) ?? null,
    wants: (d.areas_requested as unknown) ?? (d.lit_areas as unknown) ?? null,
    quote_total: dollars(r.jobber_quote_total_cents),
    quote_sent: r.jobber_quote_sent_at ?? r.quoted_at ?? null,
    quote_opened: r.jobber_quote_viewed_at ?? null,
    approved: r.jobber_quote_approved_at ?? r.won_at ?? null,
    lost_reason: r.lost_reason ?? null,
    next_action: r.next_action_note ?? null,
    days_old: daysSince(r.created_at, now),
  }
}

async function leadsSince(db: SupabaseClient, orgId: string, days: number, now: Date) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const { data, error } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('org_id', orgId)
    .gte('created_at', since)
    .or('is_test.is.null,is_test.eq.false')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  // Designer rows are staff practice, not leads.
  return ((data ?? []) as unknown as Row[]).filter((r) => r.source !== 'designer')
}

export async function runAskTool(
  db: SupabaseClient,
  orgId: string,
  name: string,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<unknown> {
  const clampDays = (v: unknown, def: number) => Math.min(Math.max(Number(v) || def, 1), 400)

  if (name === 'find_people') {
    const q = String(input.query ?? '').replace(/[,()%]/g, ' ').trim()
    if (!q) return { error: 'query is empty' }
    const like = `%${q}%`
    const { data, error } = await db
      .from('fhl_contacts')
      .select('id, lead_ids, full_name, email, mobile, street, city, zip, lifecycle, jobs_count, lifetime_value_cents, last_quote_total_cents, last_quote_at, budget_band, lost_reason, manual_note, do_not_contact')
      .eq('org_id', orgId)
      .or(['full_name', 'street', 'city', 'email', 'mobile'].map((c) => `${c}.ilike.${like}`).join(','))
      .limit(10)
    if (error) return { error: error.message }
    return (data ?? []).map((c: Row) => ({
      ...c,
      lifetime: dollars(c.lifetime_value_cents),
      last_quote: dollars(c.last_quote_total_cents),
      lifetime_value_cents: undefined,
      last_quote_total_cents: undefined,
    }))
  }

  if (name === 'person_story') {
    const { data, error } = await db
      .from('fhl_contact_timeline_v2')
      .select('kind, at, label, detail, cents')
      .eq('org_id', orgId)
      .eq('contact_id', String(input.contact_id ?? ''))
      .order('at', { ascending: false })
      .limit(40)
    if (error) return { error: error.message }
    return (data ?? []).map((e: Row) => ({ ...e, amount: dollars(e.cents), cents: undefined }))
  }

  if (name === 'list_leads') {
    let rows = await leadsSince(db, orgId, clampDays(input.days, 7), now)
    if (input.only_unquoted) rows = rows.filter((r) => !r.jobber_quote_sent_at && !r.quoted_at)
    if (input.from_ads) rows = rows.filter((r) => r.gclid || r.gbraid || r.wbraid)
    return { count: rows.length, leads: rows.slice(0, 40).map((r) => leadView(r, now)) }
  }

  if (name === 'quotes_waiting') {
    const minDays = Math.max(Number(input.min_days) || 3, 0)
    const rows = (await leadsSince(db, orgId, 120, now)).filter(
      (r) =>
        (r.jobber_quote_sent_at || r.quoted_at) &&
        !r.jobber_quote_approved_at &&
        !r.won_at &&
        r.outcome !== 'lost' &&
        (daysSince(r.jobber_quote_sent_at ?? r.quoted_at, now) ?? 0) >= minDays,
    )
    return {
      count: rows.length,
      waiting: rows
        .map((r) => ({ ...leadView(r, now), days_waiting: daysSince(r.jobber_quote_sent_at ?? r.quoted_at, now) }))
        .sort((a, b) => (b.days_waiting ?? 0) - (a.days_waiting ?? 0))
        .slice(0, 40),
    }
  }

  if (name === 'pipeline_numbers') {
    const rows = await leadsSince(db, orgId, clampDays(input.days, 7), now)
    const quoted = rows.filter((r) => r.jobber_quote_sent_at || r.quoted_at)
    const approved = rows.filter((r) => r.jobber_quote_approved_at || r.won_at)
    const totals = quoted.map((r) => Number(r.jobber_quote_total_cents)).filter((n) => n > 0)
    const tally = (key: (r: Row) => string) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const k = key(r) || 'unknown'
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {})
    return {
      days: clampDays(input.days, 7),
      leads: rows.length,
      from_ads: rows.filter((r) => r.gclid || r.gbraid || r.wbraid).length,
      quoted: quoted.length,
      opened: rows.filter((r) => r.jobber_quote_viewed_at).length,
      approved: approved.length,
      close_rate_of_quoted: quoted.length ? `${Math.round((approved.length / quoted.length) * 100)}%` : null,
      average_quote: totals.length ? dollars(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
      by_source: tally((r) => String(r.source ?? '')),
      by_budget: tally((r) => String(((r.details ?? {}) as Row).budget ?? 'not given')),
    }
  }

  if (name === 'money') {
    let q = db
      .from('fhl_money_by_house_season')
      .select('house_key, season_year, quoted_cents, accepted_cents, collected_cents, outstanding_cents')
      .eq('org_id', orgId)
    const season = Number(input.season) || null
    if (season) q = q.eq('season_year', season)
    const { data, error } = await q.order('season_year', { ascending: false }).limit(2000)
    if (error) return { error: error.message }
    const rows = (data ?? []) as Row[]
    const year = season ?? Math.max(...rows.map((r) => Number(r.season_year) || 0))
    const these = rows.filter((r) => Number(r.season_year) === year)
    const sum = (k: string) => these.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    return {
      season: year,
      houses: these.length,
      quoted: dollars(sum('quoted_cents')),
      accepted: dollars(sum('accepted_cents')),
      collected: dollars(sum('collected_cents')),
      outstanding: dollars(sum('outstanding_cents')),
      biggest: these
        .sort((a, b) => (Number(b.accepted_cents) || 0) - (Number(a.accepted_cents) || 0))
        .slice(0, 10)
        .map((r) => ({ house: r.house_key, accepted: dollars(r.accepted_cents), outstanding: dollars(r.outstanding_cents) })),
    }
  }

  return { error: `unknown tool ${name}` }
}
