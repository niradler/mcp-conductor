/**
 * Tests for permission builder
 */

import { assertEquals, assertThrows } from '@std/assert'
import { PermissionBuilder } from '../src/executor/permissions.ts'

Deno.test('PermissionBuilder - no permissions', () => {
  const builder = new PermissionBuilder({})
  const flags = builder.build()
  assertEquals(flags, [])
})

Deno.test('PermissionBuilder - all permissions', () => {
  const builder = new PermissionBuilder({ all: true })
  const flags = builder.build()
  assertEquals(flags, ['--allow-all'])
})

Deno.test('PermissionBuilder - boolean network permission', () => {
  const builder = new PermissionBuilder({ net: true })
  const flags = builder.build()
  assertEquals(flags, ['--allow-net'])
})

Deno.test('PermissionBuilder - array network permission', () => {
  const builder = new PermissionBuilder({ net: ['example.com', 'api.github.com'] })
  const flags = builder.build()
  assertEquals(flags, ['--allow-net=example.com,api.github.com'])
})

Deno.test('PermissionBuilder - multiple permissions', () => {
  const builder = new PermissionBuilder({
    net: true,
    read: ['/tmp'],
    write: ['/tmp'],
  })
  const flags = builder.build()
  assertEquals(flags.includes('--allow-net'), true)
  assertEquals(flags.includes('--allow-read=/tmp'), true)
  assertEquals(flags.includes('--allow-write=/tmp'), true)
})

Deno.test('PermissionBuilder - merge permissions', () => {
  const base = { net: true }
  const override = { read: true, write: ['/tmp'] }
  const merged = PermissionBuilder.merge(base, override)

  assertEquals(merged.net, true)
  assertEquals(merged.read, true)
  assertEquals(Array.isArray(merged.write) && merged.write.length, 1)
})

Deno.test('PermissionBuilder - validate valid permissions', () => {
  PermissionBuilder.validate({ net: true })
  PermissionBuilder.validate({ net: ['example.com'] })
  PermissionBuilder.validate({ read: ['/tmp'], write: ['/tmp'] })
  PermissionBuilder.validate({ all: true })
})

Deno.test('PermissionBuilder - validate invalid permissions', () => {
  assertThrows(() => {
    // deno-lint-ignore no-explicit-any
    PermissionBuilder.validate({ net: 'invalid' as any })
  })

  assertThrows(() => {
    // deno-lint-ignore no-explicit-any
    PermissionBuilder.validate({ net: [123] as any })
  })
})

Deno.test('PermissionBuilder - get secure defaults', () => {
  const defaults = PermissionBuilder.getSecureDefaults()
  assertEquals(Object.keys(defaults).length, 0)
})

Deno.test('PermissionBuilder - get development defaults', () => {
  const defaults = PermissionBuilder.getDevelopmentDefaults()
  assertEquals(defaults.net, true)
  assertEquals(defaults.read, true)
  assertEquals(defaults.env, true)
})
