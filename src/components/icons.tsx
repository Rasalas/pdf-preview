import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ArchiveRestore,
  Circle,
  Crop,
  CopyPlus,
  Download,
  Ellipsis,
  Eraser,
  File,
  Feather,
  FileInput,
  FileOutput,
  FileCheck2,
  FilePlus2,
  FileX2,
  FolderOpen,
  Highlighter,
  Info,
  LayoutGrid,
  LockOpen,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  PanelLeft,
  Pencil,
  PenTool,
  Plus,
  Printer,
  Redo2,
  Rows2,
  RotateCcw,
  RotateCw,
  ScanText,
  Search,
  Shrink,
  Signature,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideProps,
} from 'lucide-react'
import { siBuymeacoffee, siGithub, siGithubsponsors } from 'simple-icons'

const icons = {
  sidebar: PanelLeft,
  pages: LayoutGrid,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  rotateLeft: RotateCcw,
  rotateRight: RotateCw,
  trash: Trash2,
  plus: Plus,
  undo: Undo2,
  redo: Redo2,
  save: Download,
  print: Printer,
  duplicate: CopyPlus,
  combine: Rows2,
  file: FilePlus2,
  open: FolderOpen,
  blank: File,
  export: FileOutput,
  import: FileInput,
  withoutJbig2: FileCheck2,
  closeDocument: FileX2,
  shrink: Shrink,
  crop: Crop,
  fitWidth: MoveHorizontal,
  restore: ArchiveRestore,
  unlock: LockOpen,
  erase: Eraser,
  close: X,
  chevron: ChevronDown,
  search: Search,
  scanText: ScanText,
  markup: PenTool,
  cursor: MousePointer2,
  marker: Highlighter,
  square: Square,
  circle: Circle,
  line: Slash,
  arrow: MoveUpRight,
  pen: Pencil,
  nib: Feather,
  text: Type,
  signature: Signature,
  more: Ellipsis,
  up: ArrowUp,
  down: ArrowDown,
  check: Check,
  info: Info,
} as const

export type IconName = keyof typeof icons

export function Icon({ name, width = 18, height, ...props }: { name: IconName; width?: number; height?: number } & Omit<LucideProps, 'size'>) {
  const Component = icons[name]
  return <Component size={width} height={height ?? width} strokeWidth={1.75} aria-hidden="true" className="icon" {...props} />
}

const brands = { github: siGithub, coffee: siBuymeacoffee, sponsors: siGithubsponsors }

/** Official brand marks from Simple Icons, in their brand colour unless told otherwise. */
export function BrandIcon({ name, size = 20, mono = false }: { name: keyof typeof brands; size?: number; mono?: boolean }) {
  const brand = brands[name]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="icon" fill={mono ? 'currentColor' : `#${brand.hex}`}>
      <path d={brand.path} />
    </svg>
  )
}
