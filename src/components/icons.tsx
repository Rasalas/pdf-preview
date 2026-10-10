import type { SVGProps } from 'react'

const paths = {
  sidebar: 'M3.5 5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM9.5 3.5v17M5.75 7.5h1.5M5.75 10h1.5M5.75 12.5h1.5',
  zoomIn: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5l5 5M7.5 10.5h6M10.5 7.5v6',
  zoomOut: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5l5 5M7.5 10.5h6',
  rotateLeft: 'M4.5 9.5a8 8 0 1 1 1.6 7.4M4.5 4.5v5h5',
  rotateRight: 'M19.5 9.5a8 8 0 1 0-1.6 7.4M19.5 4.5v5h-5',
  trash: 'M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14.5l-5-5 5-5M4 9.5h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14.5l5-5-5-5M20 9.5H10a6 6 0 0 0 0 12h3',
  share: 'M12 15V3.5M7.5 8 12 3.5 16.5 8M6.5 11.5h-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1',
  print: 'M7 8.5v-5h10v5M7 17.5H4.5v-7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7H17M7 14.5h10v6H7z',
  duplicate: 'M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4',
  page: 'M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4',
  file: 'M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4M12 11v6M9 14h6',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M8 10l4 4 4-4',
  search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5l5 5',
  markup: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9 15l1-3 5-5 2 2-5 5-3 1z',
  cursor: 'M6 3.5l12 7.5-5.5 1.5 3.5 6-2.5 1.5-3.5-6L6 18z',
  marker: 'M14.5 4.5l5 5-8 8H7.5v-4zM7.5 17.5l-3 3M4 20.5h16',
  square: 'M4.5 5.5h15v13h-15z',
  circle: 'M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M11 5h8v8',
  pen: 'M4 17c3-6 5-9 7-9s0 8 2 8 3-5 5-7M17 4.5l2.5 2.5',
  text: 'M5 6.5V5h14v1.5M12 5v14M9 19h6',
  signature: 'M3.5 16.5c2.5-7 4-9.5 5.5-9.5 2 0 0 9 2 9s2-4 3.5-4 1 3 2.5 3 2-2 3.5-2M3.5 20h17',

} as const

export type IconName = keyof typeof paths

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name]} />
    </svg>
  )
}
