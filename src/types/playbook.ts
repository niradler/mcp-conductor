export interface PlaybookMetadata {
  name: string
  description: string
  author?: string
  version?: string
  tags?: string[]
  source?: 'system' | 'user' // Track if playbook is default or user-created
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
  source?: 'system' | 'user' // Track if playbook is default or user-created
}
