import type { SVGProps } from 'react'

export type IconName =
  | 'home' | 'sales' | 'purchases' | 'recipes' | 'more'
  | 'ingredients' | 'customers' | 'formats' | 'pricing'
  | 'settings' | 'people' | 'reports' | 'account' | 'admin'
  | 'plus' | 'arrow-right' | 'arrow-left' | 'info' | 'alert'
  | 'check' | 'store' | 'package' | 'supplier' | 'card' | 'lock'
  | 'chart' | 'money' | 'menu' | 'chevron-right'

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName
  size?: number
}

export function AppIcon({ name, size = 20, className = '', ...rest }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
    ...rest,
  }

  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.8V21h13V9.8"/><path d="M9.5 21v-6h5v6"/></svg>
    case 'sales':
    case 'money':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h2"/><circle cx="16.5" cy="12" r="2.5"/></svg>
    case 'purchases':
      return <svg {...common}><path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>
    case 'recipes':
      return <svg {...common}><path d="M5 9h14l-1 10H6L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2M3 9h18"/></svg>
    case 'more':
    case 'menu':
      return <svg {...common}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
    case 'ingredients':
      return <svg {...common}><path d="M12 21V9"/><path d="M12 12c-4 0-6-2-6-6 4 0 6 2 6 6Z"/><path d="M12 16c4 0 6-2 6-6-4 0-6 2-6 6Z"/></svg>
    case 'customers':
    case 'people':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.4-4 2.5-6 5.5-6s5.1 2 5.5 6"/><circle cx="17" cy="9" r="2"/><path d="M15 14c3-.3 5 1.4 5.5 4.5"/></svg>
    case 'formats':
      return <svg {...common}><rect x="4" y="5" width="6" height="6" rx="1"/><rect x="14" y="5" width="6" height="6" rx="1"/><rect x="4" y="15" width="6" height="4" rx="1"/><rect x="14" y="15" width="6" height="4" rx="1"/></svg>
    case 'pricing':
      return <svg {...common}><path d="M4 7V4h3l11 11-6 6L1 10V7h3Z" transform="translate(2 -1)"/><circle cx="8" cy="7" r="1"/></svg>
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L13.7 2h-3.4L10 5.1a8 8 0 0 0-2.6 1.5l-2.4-1L3 9l2 1.5v3L3 15l2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.3 3.1h3.4l.3-3.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z"/></svg>
    case 'reports':
    case 'chart':
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
    case 'account':
      return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-4.7 3.2-7 7.5-7s6.8 2.3 7.5 7"/></svg>
    case 'admin':
      return <svg {...common}><path d="M12 3 4.5 6v5c0 5 3 8 7.5 10 4.5-2 7.5-5 7.5-10V6L12 3Z"/><path d="m9 12 2 2 4-5"/></svg>
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>
    case 'arrow-right':
      return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5"/></svg>
    case 'arrow-left':
      return <svg {...common}><path d="M19 12H5M10 7l-5 5 5 5"/></svg>
    case 'chevron-right':
      return <svg {...common}><path d="m9 5 7 7-7 7"/></svg>
    case 'info':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>
    case 'alert':
      return <svg {...common}><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
    case 'check':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></svg>
    case 'store':
      return <svg {...common}><path d="M4 10v10h16V10"/><path d="M3 10h18l-2-5H5l-2 5Z"/><path d="M8 20v-6h8v6"/></svg>
    case 'package':
      return <svg {...common}><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></svg>
    case 'supplier':
      return <svg {...common}><path d="M3 17h18M5 17V9h14v8M7 9V5h10v4"/><path d="M8 13h2M14 13h2"/></svg>
    case 'card':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/></svg>
    case 'lock':
      return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
  }
}
