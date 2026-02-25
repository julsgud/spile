// Minify this and prefix with `javascript:` to use as a bookmarklet.
// Or paste the minified version directly into the bookmarklet URL field.
(async () => {
  const match = location.pathname.match(/\/chat\/([a-f0-9-]{36})/)
  if (!match) {
    alert('spile: not on a claude.ai chat page')
    return
  }
  const uuid = match[1]

  // Get org ID from the organizations API
  let orgId
  try {
    const r = await fetch('https://claude.ai/api/organizations', { credentials: 'include' })
    if (!r.ok) throw new Error('orgs API ' + r.status)
    const orgs = await r.json()
    orgId = orgs[0]?.uuid || orgs[0]?.id
    if (!orgId) throw new Error('no org found')
  } catch (err) {
    alert('spile: could not get org — ' + err.message)
    return
  }

  // Fetch conversation JSON from claude.ai's internal API
  let conv
  try {
    const resp = await fetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages`,
      { credentials: 'include' }
    )
    if (!resp.ok) throw new Error('claude.ai API ' + resp.status)
    conv = await resp.json()
  } catch (err) {
    alert(`spile: failed to fetch — ${err.message}`)
    return
  }

  // POST to spile server
  try {
    const resp = await fetch('http://127.0.0.1:7842/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conv),
    })
    const result = await resp.json()
    if (result.ok) {
      alert(`spile: imported ${result.messages} messages (${result.elapsed_ms}ms)`)
    } else {
      alert(`spile: error — ${result.error}`)
    }
  } catch (err) {
    alert(`spile: could not reach server — ${err.message}`)
  }
})()
