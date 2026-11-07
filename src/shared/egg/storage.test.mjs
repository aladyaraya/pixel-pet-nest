import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const directory = dirname(fileURLToPath(import.meta.url))
const wire = value => JSON.parse(JSON.stringify(value))
const fixture = () => ({
  version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 190000, privacyAgreed: true, backScreenPetId: 'tiny_egg' },
  session: { sessionId: 'unchanged-190-seconds', tier: 'normal', durationMs: 190000,
    startedAt: 1800000000000, deadlineAt: 1800000190000, petId: 'late_duck', phase: 'waiting',
    revealedAt: null, hintedPhases: ['waiting'] },
  collection: { tiny_egg: { count: 3, lastRevealedAt: 1799999990000 } },
})

function harness(response, { failMigrationWrite = false } = {}) {
  const writes = []
  const cache = new Map()
  const bridge = { invokeNative: async (name, args) => {
    if (name === 'getStorage') return response
    assert.equal(name, 'setStorage')
    writes.push(wire(args))
    if (failMigrationWrite) throw new Error('device storage temporarily unavailable')
    return {}
  } }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    const exports = {}
    cache.set(path, exports)
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText
    vm.runInNewContext(code, { exports, require: id => {
      if (id === '@/shared/bridge') return bridge
      assert.ok(id.startsWith('.'))
      return load(resolve(dirname(path), id + '.ts'))
    } }, { filename: path })
    return exports
  }
  return { api: load(resolve(directory, 'storage.ts')), writes }
}

for (const [name, encode] of [['object', value => value], ['native JSON string', JSON.stringify]]) {
  test(`a reloaded 190 second session from ${name} retains its ID, deadline, pet and previous collection`, async () => {
    const record = fixture()
    const response = { data: encode(record) }
    const before = wire(response)
    const h = harness(response)
    assert.deepEqual(wire(await h.api.loadRecord()), record)
    assert.deepEqual(wire(await h.api.loadRecord()), record)
    assert.deepEqual(wire(response), before)
    assert.equal(h.writes.length, 0)
  })
}

test('only explicit data:null represents an absent record', async () => {
  const h = harness({ data: null })
  assert.equal(await h.api.loadRecord(), null)
  assert.equal(h.writes.length, 0)
})

for (const [name, response, code] of [
  ['missing data', {}, 'EGG_STORAGE_RESPONSE'],
  ['undefined data', { data: undefined }, 'EGG_RECORD_FORMAT'],
  ['broken JSON', { data: '{"version":2,broken' }, 'EGG_RECORD_FORMAT'],
  ['empty string', { data: '' }, 'EGG_RECORD_FORMAT'],
  ['whitespace string', { data: ' \n\t ' }, 'EGG_RECORD_FORMAT'],
  ['JSON null string', { data: 'null' }, 'EGG_RECORD_FORMAT'],
  ['JSON empty string', { data: '""' }, 'EGG_RECORD_FORMAT'],
  ['double-encoded JSON record', { data: JSON.stringify(JSON.stringify(fixture())) }, 'EGG_RECORD_FORMAT'],
  ['JSON array', { data: JSON.stringify([fixture()]) }, 'EGG_RECORD_FORMAT'],
  ['JSON number', { data: '2' }, 'EGG_RECORD_FORMAT'],
  ['JSON boolean', { data: 'false' }, 'EGG_RECORD_FORMAT'],
  ['unknown version', { data: { ...fixture(), version: 99 } }, 'EGG_RECORD_VERSION'],
  ['unknown version in JSON string', { data: JSON.stringify({ ...fixture(), version: 99 }) }, 'EGG_RECORD_VERSION'],
  ['incorrect session tier', { data: { ...fixture(), session: { ...fixture().session, tier: 'low' } } }, 'EGG_RECORD_FORMAT'],
  ['incorrect session tier in JSON string', { data: JSON.stringify({ ...fixture(), session: { ...fixture().session, tier: 'low' } }) }, 'EGG_RECORD_FORMAT'],
]) {
  test(`${name} is classified and never replaces the original record`, async () => {
    const before = wire(response)
    const h = harness(response)
    await assert.rejects(h.api.loadRecord(), { name: 'RecordReadError', code })
    await assert.rejects(h.api.loadRecord(), { code })
    assert.deepEqual(wire(response), before)
    assert.equal(h.writes.length, 0)
  })
}

for (const [name, encode] of [['object', value => value], ['native JSON string', JSON.stringify]]) {
  test(`legacy ${name} migration preserves the selected pet and counts without redrawing the session`, async () => {
    const old = { ...fixture(), version: 1, session: { ...fixture().session, mode: 'normal' } }
    delete old.session.tier
    const response = { data: encode(old) }
    const before = wire(response)
    const h = harness(response)
    const record = wire(await h.api.loadRecord())
    assert.equal(record.version, 2)
    assert.equal(record.session.tier, null)
    assert.equal(record.session.sessionId, old.session.sessionId)
    assert.equal(record.session.petId, old.session.petId)
    assert.equal(record.session.startedAt, old.session.startedAt)
    assert.equal(record.session.deadlineAt, old.session.deadlineAt)
    assert.equal(record.settings.backScreenPetId, old.settings.backScreenPetId)
    assert.deepEqual(record.collection, old.collection)
    assert.deepEqual(wire(response), before)
    assert.equal(h.writes.length, 1)
    assert.deepEqual(h.writes[0], { key: 'egg.record.v1', data: record })
  })

  test(`migration write failure from ${name} retains the recovered record for save retry`, async () => {
    const old = { ...fixture(), version: 1 }
    const h = harness({ data: encode(old) }, { failMigrationWrite: true })
    await assert.rejects(h.api.loadRecord(), error => {
      assert.equal(error.name, 'RecordMigrationError')
      assert.equal(error.record.session.sessionId, old.session.sessionId)
      assert.deepEqual(wire(error.record.collection), old.collection)
      return true
    })
    assert.equal(h.writes.length, 1)
  })
}
