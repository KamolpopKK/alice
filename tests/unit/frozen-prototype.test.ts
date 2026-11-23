import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { shadowFrozenPrototype } from '../../scripts/frozen-prototype'

/** Runs a script in a fresh realm whose Object.prototype is frozen, as in Alice Desktop. */
function runFrozen(code: string): unknown {
  const context = vm.createContext({})
  vm.runInContext('Object.freeze(Object.prototype)', context)
  return vm.runInContext(code, context)
}

const strict = (body: string) => `"use strict";\n${body}`

describe('shadowFrozenPrototype', () => {
  it('lets library prototypes define the methods a frozen Object.prototype would block', () => {
    // dayjs: proto.valueOf / toString / toJSON; d3-color define(): prototype.constructor
    const source = strict(`
      function Day(v) { this.v = v }
      var _proto = Day.prototype
      _proto.valueOf = function () { return this.v }
      _proto.toString = function () { return 'day ' + this.v }
      _proto.toJSON = function () { return { day: this.v } }
      function Color() {}
      var prototype = Object.create(Object.prototype)
      Color.prototype = prototype
      prototype.constructor = Color
      var d = new Day(3)
      ;[d + 1, String(d), JSON.stringify(d), new Color().constructor === Color, Object.keys(_proto).join(',')]
    `)
    expect(() => runFrozen(source)).toThrow(/read only/)
    expect(runFrozen(shadowFrozenPrototype(source)!)).toEqual([4, 'day 3', '{"day":3}', true, 'valueOf,toString,toJSON'])
  })

  it('keeps assignments that already worked unchanged in effect', () => {
    const source = strict(`
      var log = []
      var withSetter = Object.create({ set toString(v) { log.push('setter') } })
      withSetter.toString = function () {}
      function f() {}
      f.toString = function () { return 'custom' }
      var own = { toString: 1 }
      own.toString = 2
      ;[log.join(), Object.prototype.hasOwnProperty.call(withSetter, 'toString'), String(f), own.toString]
    `)
    expect(runFrozen(shadowFrozenPrototype(source)!)).toEqual(['setter', false, 'custom', 2])
  })

  it('rewrites only plain dotted targets and leaves other code alone', () => {
    expect(shadowFrozenPrototype('a.b.toString === x; a.valueOf == y; var toString = 1')).toBeNull()
    const out = shadowFrozenPrototype('f().toString = g; a[0].valueOf = h; this.x.toJSON = j')!
    expect(out).toContain('f().toString = g; a[0].valueOf = h; __aliceOwn$toJSON(this.x).toJSON= j')
    expect(out.startsWith('f().toString')).toBe(true)
  })
})
