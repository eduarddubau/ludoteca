// Characterises what a shell's webview interception actually catches, with no store
// involved. The four cases below are the ways a login flow can reach its redirect;
// a shell that misses any of them will silently fail against some real store.
//
//   node spikes/interception/server.mjs      → http://127.0.0.1:8899

import { createServer } from 'node:http'

const PORT = 8899
const target = (name) => `/done?case=${name}&code=harness-${name}`

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;padding:2rem">${body}</body>`

const routes = {
  '/case/http-302': (res) => {
    res.writeHead(302, { Location: target('http-302') })
    res.end()
  },
  '/case/meta-refresh': (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(page('meta refresh',
      `<meta http-equiv="refresh" content="0;url=${target('meta-refresh')}">Redirecting…`))
  },
  '/case/js-assign': (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(page('js assign',
      `Redirecting…<script>location.assign(${JSON.stringify(target('js-assign'))})</script>`))
  },
  // The realistic one: a login page that posts, then redirects from JS after a beat.
  '/case/js-replace-delayed': (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(page('js replace (delayed)',
      `Signing in…<script>setTimeout(() => location.replace(${JSON.stringify(target('js-replace-delayed'))}), 600)</script>`))
  }
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (url.pathname === '/done') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(page('done', '<h1>Redirect target reached</h1>'))
    return
  }

  const route = routes[url.pathname]
  if (route) return route(res)

  res.writeHead(404, { 'Content-Type': 'text/html' })
  res.end(page('cases', Object.keys(routes).map((p) => `<p><a href="${p}">${p}</a></p>`).join('')))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Interception harness on http://127.0.0.1:${PORT}`)
  console.log(`Cases: ${Object.keys(routes).join(', ')}`)
})
