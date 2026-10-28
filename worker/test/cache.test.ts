import { describe, expect, it } from 'vitest'
import { keys, writeResultIfNewer } from '../src/cache'
import { makeCached, makeSessionResults, FakeKV } from './fixtures'
import type { CachedResult } from '../../src/shared/results'

function envFor(kv: FakeKV) {
  return { RESULTS: kv as unknown as KVNamespace }
}

const KEY = keys.result('2026', '18', 'FP1')

describe('writeResultIfNewer', () => {
  it('refuses to downgrade a final result to a provisional candidate', async () => {
    const kv = new FakeKV()
    const final: CachedResult = makeCached({ state: 'final', complete: true, revision: 5 })
    kv.seed(KEY, final)

    const provisional = makeCached({ state: 'provisional', complete: false })
    const written = await writeResultIfNewer(envFor(kv), provisional, final)

    expect(written.state).toBe('final')
    expect(written.revision).toBe(5)
    expect(kv.puts).toBe(0)
  })

  it('promotes a provisional result to final with the next revision', async () => {
    const kv = new FakeKV()
    const provisional = makeCached({ state: 'provisional', revision: 2 })
    kv.seed(KEY, provisional)

    const final = makeCached({
      state: 'final',
      complete: true,
      session: makeSessionResults('FP1', 3),
    })
    const written = await writeResultIfNewer(envFor(kv), final, provisional)

    expect(written.state).toBe('final')
    expect(written.revision).toBe(3)
    expect(kv.puts).toBe(1)
  })

  it('skips the KV write when the durable state is unchanged', async () => {
    const kv = new FakeKV()
    const cached = makeCached({ revision: 4 })
    kv.seed(KEY, cached)

    // `checkedAt` changes on every tick but is deliberately not part of the
    // signature, so this must not consume a write.
    const same = makeCached({
      revision: 4,
      checkedAt: new Date(Date.parse(cached.checkedAt) + 60_000).toISOString(),
    })
    const written = await writeResultIfNewer(envFor(kv), same, cached)

    expect(written.revision).toBe(4)
    expect(kv.puts).toBe(0)
  })

  it('does not replace a newer revision written by another isolate', async () => {
    const kv = new FakeKV()
    const current = makeCached({ revision: 9, state: 'final', complete: true })
    kv.seed(KEY, current)

    // The caller thinks it is writing revision 4 based on a stale read.
    const stale = makeCached({ revision: 3 })
    const written = await writeResultIfNewer(envFor(kv), stale, stale)

    expect(written.revision).toBe(9)
    expect(kv.puts).toBe(0)
  })
})
