
import { GitHubItem, RepoDetails, FileContent } from '../types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);

export const parseRepoUrl = (url: string): RepoDetails => {
  const cleanUrl = url.replace(/\/$/, '');
  const urlPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(\/tree\/([^/]+)(\/(.+))?)?$/;
  const match = cleanUrl.match(urlPattern);
  
  if (!match) {
    throw new Error('Invalid GitHub repository URL. Format: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path');
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
  if (!response.ok) {
    throw new Error(`Failed to fetch repository info: ${response.status}`);
  }
  return await response.json();
};

export const fetchRepoSha = async (owner: string, repo: string, ref?: string, path: string = '', token?: string): Promise<string> => {
  const query = ref ? `?ref=${ref}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${query}`;
  
  const headers = {
    ...getHeaders(token),
    'Accept': 'application/vnd.github.object+json'
  };

  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('GitHub API rate limit exceeded. Provide a token to increase limits.');
    }
    if (response.status === 404) {
      throw new Error(`Path "${path}" not found in the repository.`);
    }
    throw new Error(`Failed to fetch metadata for path. Status: ${response.status}`);
  }

  const data = await response.json();
  return data.sha;
};

export const fetchRepoTree = async (owner: string, repo: string, sha: string, token?: string): Promise<GitHubItem[]> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
  
  const response = await fetch(url, { headers: getHeaders(token) });
  
  if (!response.ok) {
    if (response.status === 422) {
      throw new Error("Repository is too large for recursive tree fetch.");
    }
    throw new Error(`Failed to fetch tree. Status: ${response.status}`);
  }

  const data = await response.json();
  return data.tree as GitHubItem[];
};

export const fetchFileContents = async (files: { url: string; path: string }[], token?: string): Promise<FileContent[]> => {
  const headers = {
    'Accept': 'application/vnd.github.v3.raw',
    ...(token ? { 'Authorization': `token ${token}` } : {})
  };

  return await Promise.all(
    files.map(async (file) => {
      const ext = file.path.split('.').pop()?.toLowerCase() || '';
      const isImage = IMAGE_EXTENSIONS.has(ext);

      const response = await fetch(file.url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch content for ${file.path}`);
      }

      if (isImage) {
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        return { 
          ...file, 
          type: 'image', 
          dataUrl, 
          mimeType: blob.type 
        };
      } else {
        const text = await response.text();
        return { 
          ...file, 
          type: 'text', 
          text 
        };
      }
    })
  );
};

export const sortTreeItems = <T extends { path: string }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const aParts = a.path.split('/');
    const bParts = b.path.split('/');
    const minLen = Math.min(aParts.length, bParts.length);

    for (let i = 0; i < minLen; i++) {
      if (aParts[i] !== bParts[i]) {
        const aIsDeep = i < aParts.length - 1;
        const bIsDeep = i < bParts.length - 1;
        if (aIsDeep && !bIsDeep) return -1;
        if (!aIsDeep && bIsDeep) return 1;
        return aParts[i].localeCompare(bParts[i]);
      }
    }
    return aParts.length - bParts.length;
  });
};
