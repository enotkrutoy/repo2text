
export interface GitHubItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface RepoDetails {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

export interface FileContent {
  path: string;
  text?: string;
  dataUrl?: string;
  url: string;
  type: 'text' | 'image';
  mimeType?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  url: string;
  children?: Record<string, TreeNode>;
}

export interface SelectionState {
  [path: string]: boolean;
}
