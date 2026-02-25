// Minify this and prefix with `javascript:` to use as a bookmarklet.
// Or paste the minified version directly into the bookmarklet URL field.
(async () => {
  // Extract conversation UUID from the current URL
  // claude.ai URLs: https://claude.ai/chat/<uuid>
  const match = location.pathname.match(/\/chat\/([a-f0-9-]{36})/)
  if (!match) {
    alert('spile: not on a claude.ai chat page')
    return
  }
  const uuid = match[1]

  // Fetch conversation JSON from claude.ai's internal API
  let conv
  try {
    const resp = await fetch(`https://claude.ai/api/organizations/${
      // Org UUID is embedded in the page — find it from the cookie or API
      // Simplest approach: extract from a known API call
      document.cookie.match(/lastOrg=([^;]+)/)?.[1] ?? 'unknown'
    }/chat_conversations/${uuid}?tree=True&rendering_mode=messages`, {
      credentials: 'include',
    })
    if (!resp.ok) throw new Error(`claude.ai API ${resp.status}`)
    conv = await resp.json()
  } catch (err) {
    alert(`spile: failed to fetch conversation — ${err.message}`)
    return
  }

  // POST to local spile server
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
    alert(`spile: could not reach local server — is it running?\n${err.message}`)
  }
})()
