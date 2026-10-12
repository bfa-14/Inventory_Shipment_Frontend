import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconFileExport,
  IconFileImport,
  IconFileText,
  IconPaperclip,
  IconSend,
  IconX,
} from '@tabler/icons-react'

/**
 * The icons the document action bar uses.
 *
 * ITS OWN FILE BECAUSE OF FAST REFRESH: a module that exports both a component and a constant loses
 * hot reloading for the component, so the shared value moves out rather than the rule being waived.
 */
export const DocumentIcons = {
  /** "Documents (n)": scrolls to the page's Documents card. */
  documents: <IconFileText size={16} />,
  /** "Add document…": opens the "Add document" popup, like the card's own button. */
  addDocument: <IconPaperclip size={16} />,
  import: <IconFileImport size={16} />,
  save: <IconDeviceFloppy size={16} />,
  cancel: <IconX size={16} />,
  post: <IconSend size={16} />,
  exportFile: <IconFileExport size={16} />,
  back: <IconArrowLeft size={16} />,
}
