// Injects the app shell (header, sidebar, bottom nav, quick-add) around the
// page content, so each mockup file holds only the screen itself.
//   <body data-section="home|sales|purchases|recipes|more|none" data-business="Ada Kitchen" data-fab="1" data-back="Recipes">
(function () {
  const I = {
    home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
    sales: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    purchases: '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    recipes: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 20h8M12 6V3M8 7l-1-2M16 7l1-2"/>',
    more: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    whatsapp: '<path d="M21 12a9 9 0 0 1-13 8l-5 1 1-5a9 9 0 1 1 17-4z"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 15a5 5 0 0 1 5 5"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    ingredients: '<path d="M4 20c0-8 4-14 16-16-2 12-8 16-16 16z"/><path d="M4 20c4-6 8-9 12-11"/>',
    formats: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    pricing: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    customers: '<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    supplier: '<path d="M3 7h11v10H3zM14 11h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    admin: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>',
    site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    google: '<circle cx="12" cy="12" r="9"/><path d="M12 12h8M12 7v10"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  }
  window.icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.more}</svg>`
  // replace <i data-i="name"> placeholders
  const render = () => document.querySelectorAll('i[data-i]').forEach((el) => { el.outerHTML = window.icon(el.dataset.i, el.className) })

  const NAV = [['home', 'Home', '/dashboard'], ['sales', 'Sales', '/sales'], ['purchases', 'Purchases', '/purchases'], ['recipes', 'Recipes', '/recipes'], ['more', 'More', '/more']]
  const b = document.body, section = b.dataset.section || 'none', biz = b.dataset.business || 'Menu Master'
  if (section === 'none') { render(); return }
  const logo = '../../03-logo/svg/mark.svg'
  const navLinks = (cls) => NAV.map(([k, l]) => `<a class="${cls}" ${k === section ? 'aria-current="page"' : ''}>${window.icon(k)}<span>${l}</span></a>`).join('')
  const sidebar = `<aside class="sidebar">
    <div class="brand"><img src="${logo}" alt=""><span>${biz}</span></div>
    ${navLinks('side-link')}
    <div class="foot"><a class="side-link">${window.icon('settings')}<span>Settings</span></a><a class="side-link">${window.icon('account')}<span>Account</span></a></div>
  </aside>`
  const header = `<header class="app-header">
    <div class="brand"><img src="${logo}" alt=""><span>${biz}</span></div>
    <div style="display:flex;gap:8px;align-items:center">
      <a class="btn primary desk-cta" style="min-height:40px">${window.icon('plus')} New sale</a>
      <a class="chip account" aria-label="Your account">${window.icon('account')}</a>
    </div>
  </header>`
  const bottom = `<nav class="bottom-nav" aria-label="Primary">${navLinks('')}</nav>`
  const fab = b.dataset.fab === '0' ? '' : `<button class="fab" aria-label="Add">${window.icon('plus')}</button>`
  const content = b.innerHTML
  b.innerHTML = `<div class="shell">${sidebar}<div class="content">${header}${content}${bottom}${fab}</div></div>`
  render()
})()
