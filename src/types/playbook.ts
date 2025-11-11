export interface PlaybookMetadata {
  name: string
  description: string
  author?: string
  version?: string
  tags?: string[]
}

export interface PlaybookFile {
  metadata: PlaybookMetadata
  content: string
  codePath: string
  folderPath: string
}

export interface PlaybookListItem {
  name: string
  description: string
  folderName: string
  hasCode: boolean
}
