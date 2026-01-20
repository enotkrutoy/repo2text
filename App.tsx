
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  Search, Github, Info, Copy, Download, FileText, AlertCircle, Loader2, 
  ChevronRight, FileCode, Type, Image as ImageIcon, Key, Filter, X
} from 'lucide-react';
import { 
  parseRepoUrl, fetchRepoSha, fetchRepoTree, fetchFileContents, 
  sortTreeItems, fetchRepoInfo 
} from './services/githubService';
import { GitHubItem, RepoDetails, TreeNode, SelectionState, FileContent } from './types';
import FileTree from './components/FileTree';
// @ts-ignore
import { jsPDF } from 'jspdf';

const COMMON_EXTENSIONS = new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'h', 'html', 'css', 'md', 'json', 'txt', 'go', 'rs', 'php', 'rb', 'sql', 'yaml', 'yml', 'toml']);

const buildTree = (items: GitHubItem[]): TreeNode => {
  const root: TreeNode = { name: 'root', path: '', type: 'tree', sha: '', url: '', children: {} };
  items.forEach(item => {
    const parts = item.path.split('/');
    let current = root;
    parts.forEach((part, index) => {
      if (!current.children) current.children = {};
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: index === parts.length - 1 ? item.type : 'tree',
          sha: index === parts.length - 1 ? item.sha : '',
          url: index === parts.length - 1 ? item.url : '',
          children: {}
        };
      }
      current = current.children[part];
    });
  });
  return root;
};

const buildAsciiIndex = (node: TreeNode, prefix: string = '', isLast: boolean = true): string => {
  if (node.name === 'root') {
    const children = Object.values(node.children || {}) as TreeNode[];
    return children.map((child, i) => buildAsciiIndex(child, '', i === children.length - 1)).join('');
  }
  const connector = isLast ? '└── ' : '├── ';
  let result = `${prefix}${connector}${node.name}\n`;
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  const children = Object.values(node.children || {}) as TreeNode[];
  children.forEach((child, i) => {
    result += buildAsciiIndex(child, childPrefix, i === children.length - 1);
  });
  return result;
};

const App: React.FC = () => {
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState(() => localStorage.getItem('repopacker_token') || '');
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [selection, setSelection] = useState<SelectionState>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'txt' | 'md' | 'pdf'>('txt');
  const [activeRepoDetails, setActiveRepoDetails] = useState<RepoDetails | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    localStorage.setItem('repopacker_token', token);
  }, [token]);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    setIsLoading(true);
    setError(null);
    setTreeData(null);
    setOutput('');

    try {
      const details = parseRepoUrl(repoUrl);
      setActiveRepoDetails(details);
      
      const repoInfo = await fetchRepoInfo(details.owner, details.repo, token);
      const branch = details.ref || repoInfo.default_branch;
      const targetSha = await fetchRepoSha(details.owner, details.repo, branch, details.path || '', token);
      
      const items = await fetchRepoTree(details.owner, details.repo, targetSha, token);
      const root = buildTree(items);
      setTreeData(root);

      const initialSelection: SelectionState = {};
      items.forEach(item => {
        if (item.type === 'blob') {
          const ext = item.path.split('.').pop()?.toLowerCase() || '';
          initialSelection[item.path] = COMMON_EXTENSIONS.has(ext);
        }
      });
      setSelection(initialSelection);
      setExpandedPaths(new Set(['', ...items.filter(i => i.type === 'tree' && i.path.split('/').length < 2).map(i => i.path)]));
    } catch (err: any) {
      setError(err.message || 'Fetch failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = useCallback((path: string, isFile: boolean) => {
    setSelection(prev => {
      const next = { ...prev };
      if (isFile) {
        next[path] = !prev[path];
      } else {
        const currentlySelected = Object.keys(prev).filter(p => p.startsWith(path + '/') || p === path);
        const allSelected = currentlySelected.length > 0 && currentlySelected.every(p => prev[p]);
        
        const traverseAndSet = (node: TreeNode, val: boolean) => {
          if (node.type === 'blob') next[node.path] = val;
          if (node.children) Object.values(node.children).forEach(c => traverseAndSet(c, val));
        };

        const findNode = (node: TreeNode): boolean => {
          if (node.path === path) { traverseAndSet(node, !allSelected); return true; }
          return node.children ? Object.values(node.children).some(findNode) : false;
        };
        if (treeData) findNode(treeData);
      }
      return next;
    });
  }, [treeData]);

  const generateOutput = async () => {
    if (!treeData) return;
    setIsGenerating(true);
    try {
      const selectedFiles: { path: string, url: string }[] = [];
      const traverse = (node: TreeNode) => {
        if (node.type === 'blob' && selection[node.path]) selectedFiles.push({ path: node.path, url: node.url });
        if (node.children) Object.values(node.children).forEach(traverse);
      };
      traverse(treeData);
      
      if (selectedFiles.length === 0) throw new Error('No files selected');
      
      const contents = await fetchFileContents(selectedFiles, token);
      let formatted = `REPOSITORY: ${activeRepoDetails?.owner}/${activeRepoDetails?.repo}\nSTRUCTURE:\n${buildAsciiIndex(treeData)}\n\n`;
      
      contents.forEach(file => {
        formatted += `\n---\nFILE: ${file.path}\n---\n\n${file.text || `[Image: ${file.mimeType}]`}\n`;
      });
      setOutput(formatted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (downloadFormat === 'pdf') {
      const doc = new jsPDF();
      doc.setFontSize(24);
      doc.text(`${activeRepoDetails?.repo} - Context Bundle`, 20, 30);
      doc.setFontSize(10);
      doc.text(`Generated on ${new Date().toLocaleString()}`, 20, 40);
      
      let y = 60;
      const lines = output.split('\n');
      lines.forEach(line => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line.substring(0, 90), 20, y);
        y += 5;
      });
      doc.save(`${activeRepoDetails?.repo}-bundle.pdf`);
    } else {
      const blob = new Blob([output], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeRepoDetails?.repo}-bundle.${downloadFormat}`;
      a.click();
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 font-sans p-4 md:p-8 selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row items-center justify-between gap-6 bg-zinc-900/40 p-6 rounded-3xl border border-white/5 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-indigo-500/20 shadow-2xl">
              <Github className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">RepoPacker v2</h1>
              <p className="text-zinc-500 text-xs">High-Fidelity Context Generator</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="password"
                placeholder="GitHub Token (Optional)"
                className="bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm w-48 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <button onClick={() => setShowTokenInfo(!showTokenInfo)} className="text-zinc-500 hover:text-white transition-colors">
              <Info className="w-5 h-5" />
            </button>
          </div>
        </header>

        <section className="bg-zinc-900/20 p-2 rounded-3xl border border-white/5">
          <form onSubmit={handleFetch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input 
                type="text" 
                placeholder="https://github.com/owner/repo"
                className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <button 
              type="submit"
              disabled={isLoading}
              className="px-8 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-2xl transition-all flex items-center gap-2"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
              Fetch
            </button>
          </form>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[700px]">
          <div className="bg-zinc-900/30 rounded-3xl border border-white/5 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Explorer</span>
              </div>
              <div className="flex gap-2">
                <select 
                  className="bg-black border border-white/10 text-[10px] rounded-lg px-2 py-1 outline-none"
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value as any)}
                >
                  <option value="txt">TEXT</option>
                  <option value="md">MD</option>
                  <option value="pdf">PDF</option>
                </select>
                <button 
                  onClick={generateOutput}
                  disabled={isGenerating || !treeData}
                  className="bg-emerald-600 text-[10px] font-bold px-3 py-1 rounded-lg hover:bg-emerald-500 disabled:opacity-30"
                >
                  {isGenerating ? 'PACKING...' : 'GENERATE'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {treeData ? (
                <div className="space-y-1">
                  {(Object.values(treeData.children || {}) as TreeNode[]).map(node => (
                    <FileTree 
                      key={node.path}
                      node={node}
                      selection={selection}
                      onToggle={handleToggle}
                      expandedPaths={expandedPaths}
                      onToggleExpand={(p) => setExpandedPaths(prev => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      })}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-10">
                  <FileCode className="w-20 h-20 mb-4" />
                  <p className="text-sm">Enter a URL to begin</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-zinc-900/30 rounded-3xl border border-white/5 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Preview</span>
              {output && (
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard.writeText(output)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={handleDownload} className="flex items-center gap-2 bg-indigo-600 text-[10px] font-bold px-3 py-1 rounded-lg hover:bg-indigo-500">
                    <Download className="w-3 h-3" /> EXPORT
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 p-0 bg-black/20">
              <textarea 
                readOnly
                className="w-full h-full p-6 bg-transparent text-[11px] font-mono text-zinc-400 resize-none outline-none custom-scrollbar"
                placeholder="Output will appear here..."
                value={output}
              />
            </div>
          </div>
        </div>
      </div>
      {error && (
        <div className="fixed bottom-8 right-8 bg-red-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-4">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-bold">{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
};

export default App;
