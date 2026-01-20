
import { GitHubItem, RepoDetails, FileContent } from '../types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);
const CONCURRENCY_LIMIT = 10;

export const parseRepoUrl = (url: string): RepoDetails => {
  const cleanUrl = url.replace(/\/$/, '');
  const urlPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(\/tree\/([^/]+)(\/(.+))?)?$/;
  const match = cleanUrl.match(urlPattern);
  
  if (!match) {
    throw new Error('Invalid GitHub repository URL.');
  }

  return {
    owner: match[1],
    repo: match[2],
    ref: match[4],
    path: match[6]
  };
};

const getHeaders = (token?: string) => {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }
  return headers;
};

export const fetchRepoInfo = async (owner: string, repo: string, token?: string) => {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await fetch(url, { headers: getHeaders(token) });
  if (!response.ok) throw new Error(`Failed to fetch repo info: ${response.status}`);
  return await response.json();
};

export const fetchRepoSha = async (owner: string, repo: string, ref?: string, path: string = '', token?: string): Promise<string> => {
  const query = ref ? `?ref=${ref}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${query}`;
  const response = await fetch(url, { headers: { ...getHeaders(token), 'Accept': 'application/vnd.github.object+json' } });
  if (!response.ok) throw new Error(`Path not found or API error: ${response.status}`);
  const data = await response.json();
  return data.sha;
};

export const fetchRepoTree = async (owner: string, repo: string, sha: string, token?: string): Promise<GitHubItem[]> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
  const response = await fetch(url, { headers: getHeaders(token) });
  if (!response.ok) throw new Error("Repository tree fetch failed.");
  const data = await response.json();
  return data.tree as GitHubItem[];
};

export const fetchFileContents = async (files: { url: string; path: string }[], token?: string): Promise<FileContent[]> => {
  const results: FileContent[] = [];
  const headers = {
    'Accept': 'application/vnd.github.v3.raw',
    ...(token ? { 'Authorization': `token ${token}` } : {})
  };

  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    const chunk = files.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        const ext = file.path.split('.').pop()?.toLowerCase() || '';
        const isImage = IMAGE_EXTENSIONS.has(ext);
        const response = await fetch(file.url, { headers });
        
        if (!response.ok) return null;

        if (isImage) {
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((res) => {
            const reader = new FileReader();
            reader.onloadend = () => res(reader.result as string);
            reader.readAsDataURL(blob);
          });
          return { ...file, type: 'image', dataUrl, mimeType: blob.type } as FileContent;
        } else {
          const text = await response.text();
          return { ...file, type: 'text', text } as FileContent;
        }
      })
    );
    results.push(...(chunkResults.filter(Boolean) as FileContent[]));
  }
  return results;
};

export const sortTreeItems = <T extends { path: string }>(items: T[]): T[] => {
  return [...items].sort((a, b) => a.path.localeCompare(b.path));
};
