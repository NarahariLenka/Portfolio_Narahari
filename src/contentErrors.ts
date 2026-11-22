/**
 * Development only: shows a red bar at the top of the page when a file in /content has a
 * typing mistake (see content-guard.ts). It disappears as soon as the file is fixed.
 */
let bar: HTMLDivElement | null = null

function show(messages: string[]) {
  if (!messages.length) {
    bar?.remove()
    bar = null
    return
  }
  if (!bar) {
    bar = document.createElement('div')
    bar.setAttribute('role', 'alert')
    bar.style.cssText =
      'position:fixed;inset:0 0 auto 0;z-index:9999;padding:12px 18px;background:#b42318;color:#fff;' +
      'font:500 14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 4px 18px rgb(0 0 0/.3)'
    document.body.append(bar)
  }
  bar.textContent = messages.join('  •  ')
}

if (import.meta.hot) {
  import.meta.hot.on('content-errors', show)
  fetch('/__content-errors')
    .then((r) => r.json())
    .then(show)
    .catch(() => {})
}
