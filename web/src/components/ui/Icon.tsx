type IconName =
  | 'upload' | 'file' | 'tools' | 'trash' | 'bell' | 'save' | 'export' | 'logout'
  | 'orbit' | 'point' | 'line' | 'polygon' | 'measure' | 'annotation'
  | 'undo' | 'redo' | 'marker-delete' | 'file-delete'

const paths: Record<IconName, ReactNode> = {
  upload: <><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M5 15v4h14v-4" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6m-6 4h6" /></>,
  tools: <><path d="M14.5 6.5a4 4 0 0 0-5-5L12 4 9 7 6.5 4.5a4 4 0 0 0 5 5L4 17l3 3 7.5-7.5a4 4 0 0 0 5-5L17 10l-3-3z" /></>,
  trash: <><path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6m4-6v6" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  save: <><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7" /></>,
  export: <><path d="M12 4v12m0 0 4-4m-4 4-4-4" /><path d="M5 18v3h14v-3" /></>,
  logout: <><path d="M10 4H4v16h6M14 8l4 4-4 4m4-4H8" /></>,
  orbit: <><circle cx="12" cy="12" r="3" /><path d="M3 12c0-3 4-6 9-6s9 3 9 6-4 6-9 6-9-3-9-6z" /></>,
  point: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3" /></>,
  line: <><path d="m4 18 6-8 4 3 6-8" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="5" r="1.5" /></>,
  polygon: <><path d="m12 3 9 7-4 11H7L3 10z" /><circle cx="12" cy="3" r="1" /><circle cx="21" cy="10" r="1" /></>,
  measure: <><path d="M4 17 17 4l3 3L7 20zM11 10l3 3m0-6 3 3M8 13l3 3" /></>,
  annotation: <><path d="M4 4h16v13H9l-5 4z" /><path d="M8 9h8m-8 4h5" /></>,
  undo: <><path d="m9 7-5 5 5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
  redo: <><path d="m15 7 5 5-5 5" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
  'marker-delete': <><path d="M5 5l14 14M19 5 5 19" /><circle cx="12" cy="12" r="8" /></>,
  'file-delete': <><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13l6 6m0-6-6 6" /></>,
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
import type { ReactNode } from 'react'
