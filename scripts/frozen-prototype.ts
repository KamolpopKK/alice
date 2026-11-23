import type { Plugin } from 'vite'

/**
 * Alice Desktop freezes Object.prototype before any page script runs (`freezePrototype` in
 * src-tauri/tauri.conf.json). Libraries that set `constructor`, `toString`, `valueOf`, `toJSON` or
 * `toLocaleString` on their own objects by plain assignment (`proto.toString = fn`) then throw,
 * because the inherited property they would shadow is read-only (the "override mistake"). Mermaid
 * pulls in several of them (dayjs, d3, elkjs), so no diagram rendered in Desktop.
 *
 * This build step rewrites `target.key = value` in dependencies to
 * `__aliceOwn$key(target).key = value`. The helper gives `target` its own writable property only
 * when the property it would shadow is a read-only data property, which is exactly the case that
 * throws; every other assignment behaves as before. Computed or call-result targets
 * (`a[0].toString =`, `f().toString =`) are left unchanged.
 */
const KEYS = ['constructor', 'toString', 'valueOf', 'toJSON', 'toLocaleString'] as const

// เป้าหมายต้องเป็นชื่อหรือ a.b.c ล้วน: ห้ามต่อจาก . ) ] เพื่อไม่ตัดกลางนิพจน์อย่าง f().x.toString
const ASSIGNMENT = new RegExp(`(?<![\\w$.)\\]])([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\.(${KEYS.join('|')})\\s*=(?![=>])`, 'g')

// ต่อท้ายไฟล์: function declaration ถูก hoist และไม่ไปขวาง "use strict" ที่ต้นไฟล์
const HELPERS = [
  'function __aliceOwn(o,k){if(o===null||(typeof o!=="object"&&typeof o!=="function"))return o;',
  'for(var p=Object.getPrototypeOf(o);p!==null;p=Object.getPrototypeOf(p)){var d=Object.getOwnPropertyDescriptor(p,k);',
  'if(d){if(!Object.prototype.hasOwnProperty.call(o,k)&&"value" in d&&!d.writable&&Object.isExtensible(o))',
  'Object.defineProperty(o,k,{value:d.value,writable:true,enumerable:true,configurable:true});break}}return o}',
  ...KEYS.map((key) => `function __aliceOwn$${key}(o){return __aliceOwn(o,"${key}")}`),
].join('')

/** Rewrites assignments that would throw on a frozen Object.prototype; returns null when there are none. */
export function shadowFrozenPrototype(code: string): string | null {
  let changed = false
  const out = code.replace(ASSIGNMENT, (_, target: string, key: string) => {
    changed = true
    return `__aliceOwn$${key}(${target}).${key}=`
  })
  return changed ? `${out}\n${HELPERS}\n` : null
}

/** Applies {@link shadowFrozenPrototype} to dependency code in the web build and the dev optimizer. */
export function frozenPrototypeCompat(): Plugin {
  return {
    name: 'alice:frozen-prototype-compat',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/].+\.[cm]?js(\?|$)/.test(id)) return null
      const out = shadowFrozenPrototype(code)
      return out === null ? null : { code: out, map: null }
    },
  }
}
