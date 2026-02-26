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

  // Extract file paths from React fiber tree via Download buttons
  function extractFilePaths() {
    const paths = []
    document.querySelectorAll('[aria-label="Download"]').forEach(btn => {
      const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber'))
      if (!fiberKey) return
      let fiber = btn[fiberKey]
      let depth = 0
      while (fiber && depth < 20) {
        const props = fiber.memoizedProps
        if (props) {
          for (const v of Object.values(props)) {
            if (typeof v === 'string' && v.includes('/mnt/user-data/')) {
              paths.push(v)
              return
            }
          }
        }
        fiber = fiber.return
        depth++
      }
    })
    return [...new Set(paths)]
  }

  const capturedFiles = extractFilePaths()

  // POST to spile server
  try {
    const resp = await fetch('https://botilcetin.tail67efd7.ts.net/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...conv, captured_files: capturedFiles }),
    })
    const result = await resp.json()
    if (result.ok) {
      const filePart = result.files > 0 ? `, ${result.files} file(s)` : ''
      alert(`spile: imported ${result.messages} messages${filePart} (${result.elapsed_ms}ms)`)
    } else {
      alert(`spile: error — ${result.error}`)
    }
  } catch (err) {
    alert(`spile: could not reach server — ${err.message}`)
  }
})()
