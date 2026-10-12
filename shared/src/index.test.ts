import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createUserSchema } from './index.js'

const valid = { name: 'Jane Doe', email: 'jane@example.com', password: 'password123' }

// Field → first error message, for asserting which rule failed.
function errorsFor(input: unknown) {
  const result = createUserSchema.safeParse(input)
  if (result.success) return {}
  const { fieldErrors } = z.flattenError(result.error)
  return Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]))
}

describe('createUserSchema', () => {
  it('accepts valid input', () => {
    expect(createUserSchema.parse(valid)).toEqual(valid)
  })

  it('trims the name and trims and lowercases the email', () => {
    const parsed = createUserSchema.parse({ ...valid, name: '  Jane  ', email: '  Jane@Example.COM ' })
    expect(parsed.name).toBe('Jane')
    expect(parsed.email).toBe('jane@example.com')
  })

  it('does not trim the password', () => {
    expect(createUserSchema.parse({ ...valid, password: ' pass word ' }).password).toBe(' pass word ')
  })

  it('requires every field', () => {
    expect(errorsFor({ name: '', email: '', password: '' })).toEqual({
      name: 'Name is required',
      email: 'Email is required',
      password: 'Password must be at least 8 characters',
    })
  })

  it('treats a whitespace-only name as missing', () => {
    expect(errorsFor({ ...valid, name: '   ' })).toEqual({ name: 'Name is required' })
  })

  it('rejects a name over 100 characters', () => {
    expect(errorsFor({ ...valid, name: 'a'.repeat(100) })).toEqual({})
    expect(errorsFor({ ...valid, name: 'a'.repeat(101) })).toEqual({
      name: 'Name must be at most 100 characters',
    })
  })

  it.each(['not-an-email', 'jane@', '@example.com', 'jane example.com'])(
    'rejects the invalid email %j',
    (email) => {
      expect(errorsFor({ ...valid, email })).toEqual({ email: 'Enter a valid email address' })
    },
  )

  it('enforces the 8–128 character password limits', () => {
    expect(errorsFor({ ...valid, password: 'a'.repeat(7) })).toEqual({
      password: 'Password must be at least 8 characters',
    })
    expect(errorsFor({ ...valid, password: 'a'.repeat(8) })).toEqual({})
    expect(errorsFor({ ...valid, password: 'a'.repeat(128) })).toEqual({})
    expect(errorsFor({ ...valid, password: 'a'.repeat(129) })).toEqual({
      password: 'Password must be at most 128 characters',
    })
  })

  it('rejects non-string values', () => {
    expect(Object.keys(errorsFor({ name: 1, email: null, password: {} })).sort()).toEqual([
      'email',
      'name',
      'password',
    ])
  })

  it('strips unknown keys such as role', () => {
    expect(createUserSchema.parse({ ...valid, role: 'admin' })).not.toHaveProperty('role')
  })
})
