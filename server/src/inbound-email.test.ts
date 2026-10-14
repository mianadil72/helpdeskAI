import { describe, expect, it, vi } from 'vitest'
import { htmlToText, isAutoReply } from './inbound-email.js'

vi.mock('./db.js', () => ({ prisma: {} }))

describe('isAutoReply', () => {
  const from = { email: 'student@example.com' }

  it.each([
    [{ 'auto-submitted': 'auto-replied' }],
    [{ 'auto-submitted': 'Auto-Generated' }],
    [{ precedence: 'bulk' }],
    [{ precedence: 'junk' }],
    [{ precedence: 'list' }],
    [{ precedence: 'auto_reply' }],
    [{ 'x-autoreply': 'yes' }],
    [{ 'x-autorespond': '' }],
  ])('flags %o', (headers) => {
    expect(isAutoReply({ from, headers })).toBe(true)
  })

  it('flags bounces from mailer-daemon and postmaster', () => {
    expect(isAutoReply({ from: { email: 'mailer-daemon@mail.example.com' }, headers: {} })).toBe(true)
    expect(isAutoReply({ from: { email: 'postmaster@example.com' }, headers: {} })).toBe(true)
  })

  it('lets normal email through', () => {
    expect(isAutoReply({ from, headers: {} })).toBe(false)
    expect(isAutoReply({ from, headers: { 'auto-submitted': 'no', precedence: 'normal' } })).toBe(false)
  })
})

describe('htmlToText', () => {
  it('keeps line breaks and drops tags, styles and scripts', () => {
    const html =
      '<html><head><title>x</title></head><style>p{}</style><body><p>Hi&nbsp;there,</p>' +
      '<div>Line 1<br>Line 2</div><script>alert(1)</script><p>&lt;b&gt; &quot;ok&quot; &#39;s</p></body></html>'
    expect(htmlToText(html)).toBe('Hi there,\nLine 1\nLine 2\n<b> "ok" \'s')
  })
})
