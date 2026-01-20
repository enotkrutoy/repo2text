
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  Search, Github, Copy, Download, FileText, AlertCircle, Loader2, 
  ChevronRight, FileCode, Key, Filter, X, Check, Layers, Code2, Trash2
} from 'lucide-react';
import { 
  parseRepoUrl, fetchRepoSha, fetchRepoTree, fetchFileContents, 
  fetchRepoInfo 
} from './services/githubService';
import { GitHubItem, RepoDetails, TreeNode, SelectionState, SelectionStatusMap, SelectionStatus } from './types';
import FileTree from './components/FileTree';
// @ts-ignore
import { jsPDF } from 'jspdf';

const CODE_EXTS = new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'h', 'html', 'css', 'md', 'json', 'go', 'rs', 'php', 'rb', 'sql', 'yaml', 'yml', 'toml']);

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [selection, setSelection] = useState<SelectionState>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'txt' | 'md' | 'pdf'>('txt');
  const [activeRepoDetails, setActiveRepoDetails] = useState<RepoDetails | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  useEffect(() => {
    localStorage.setItem('repopacker_token', token);
  }, [token]);

  // Высокопроизводительный расчет состояний дерева (O(N))
  const selectionStatusMap = useMemo(() => {
    const map: SelectionStatusMap = {};
    if (!treeData) return map;

    const compute = (node: TreeNode): SelectionStatus => {
      if (node.type === 'blob') {
        const s = selection[node.path] ? 'checked' : 'unchecked';
        map[node.path] = s;
        return s;
      }
      const children = Object.values(node.children || {});
      if (children.length === 0) {
        map[node.path] = 'unchecked';
        return 'unchecked';
      }
      const statuses = children.map(c => compute(c));
      const allChecked = statuses.every(s => s === 'checked');
      const allUnchecked = statuses.every(s => s === 'unchecked');
      const status: SelectionStatus = allChecked ? 'checked' : (allUnchecked ? 'unchecked' : 'indeterminate');
      map[node.path] = status;
      return status;
    };

    compute(treeData);
    return map;
  }, [treeData, selection]);

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
          initialSelection[item.path] = CODE_EXTS.has(ext);
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
        const currentStatus = selectionStatusMap[path];
        const targetVal = currentStatus !== 'checked';
        
        const setRecursive = (node: TreeNode) => {
          if (node.type === 'blob') next[node.path] = targetVal;
          if (node.children) Object.values(node.children).forEach(setRecursive);
        };

        const findAndSet = (node: TreeNode): boolean => {
          if (node.path === path) { setRecursive(node); return true; }
          return node.children ? Object.values(node.children).some(findAndSet) : false;
        };
        if (treeData) findAndSet(treeData);
      }
      return next;
    });
  }, [treeData, selectionStatusMap]);

  const bulkAction = (type: 'all' | 'none' | 'code') => {
    const next: SelectionState = {};
    const traverse = (node: TreeNode) => {
      if (node.type === 'blob') {
        if (type === 'all') next[node.path] = true;
        else if (type === 'none') next[node.path] = false;
        else if (type === 'code') {
          const ext = node.name.split('.').pop()?.toLowerCase() || '';
          next[node.path] = CODE_EXTS.has(ext);
        }
      }
      if (node.children) Object.values(node.children).forEach(traverse);
    };
    if (treeData) traverse(treeData);
    setSelection(next);
  };

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
        formatted += `\n${'='.repeat(80)}\nFILE: ${file.path}\n${'='.repeat(80)}\n\n${file.text || `[Binary/Image Data: ${file.mimeType}]`}\n`;
      });
      setOutput(formatted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleDownload = async () => {
    if (downloadFormat === 'pdf') {
      const doc = new jsPDF();
      doc.setFont("courier", "normal");
      doc.setFontSize(10);
      
      const lines = doc.splitTextToSize(output, 180);
      let y = 20;
      lines.forEach((line: string) => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 15, y);
        y += 5;
      });
      doc.save(`${activeRepoDetails?.repo}-context.pdf`);
    } else {
      const blob = new Blob([output], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeRepoDetails?.repo}-context.${downloadFormat}`;
      a.click();
    }
  };

  return (
    <div className="min-h-screen bg-[#020203] text-slate-300 font-sans p-4 md:p-10 selection:bg-indigo-500/40">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col lg:flex-row items-center justify-between gap-8 bg-zinc-900/30 p-8 rounded-[2.5rem] border border-white/5 backdrop-blur-3xl shadow-2xl">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl shadow-indigo-500/20 shadow-2xl">
              <Github className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
                RepoPacker <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full uppercase tracking-tighter">Pro</span>
              </h1>
              <p className="text-zinc-500 text-sm font-medium">GitHub to LLM Context Pipeline</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-black/40 p-1.5 rounded-2xl border border-white/5">
            <div className="relative group">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 group-focus-within:text-indigo-400 transition-colors" />
              <input 
                type="password"
                placeholder="GitHub API Token"
                className="bg-transparent border-none rounded-xl pl-11 pr-4 py-2.5 text-sm w-56 focus:outline-none transition-all placeholder:text-zinc-700"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
          </div>
        </header>

        <section className="bg-zinc-900/20 p-2.5 rounded-[2rem] border border-white/5 shadow-inner">
          <form onSubmit={handleFetch} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input 
                type="text" 
                placeholder="Paste GitHub Repository URL..."
                className="w-full bg-black/50 border border-white/10 rounded-2xl pl-14 pr-6 py-5 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 outline-none transition-all text-white placeholder:text-zinc-600 shadow-sm"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <button 
              type="submit"
              disabled={isLoading}
              className="px-10 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 font-bold rounded-2xl transition-all flex items-center justify-center gap-3 active:scale-95 shadow-lg"
            >
              {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ChevronRight className="w-6 h-6" />}
              Analyze Repo
            </button>
          </form>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[750px]">
          {/* Explorer Column */}
          <div className="lg:col-span-5 bg-zinc-900/30 rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden backdrop-blur-sm">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-xl">
                  <Layers className="w-4 h-4 text-indigo-400" />
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Repository Tree</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => bulkAction('code')} title="Select Code" className="p-2 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-indigo-400 transition-colors"><Code2 className="w-4 h-4" /></button>
                <button onClick={() => bulkAction('none')} title="Deselect All" className="p-2 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar scroll-smooth">
              {treeData ? (
                <div className="space-y-1">
                  {(Object.values(treeData.children || {}) as TreeNode[]).map(node => (
                    <FileTree 
                      key={node.path}
                      node={node}
                      status={selectionStatusMap[node.path] || 'unchecked'}
                      onToggle={handleToggle}
                      expandedPaths={expandedPaths}
                      onToggleExpand={(p) => setExpandedPaths(prev => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      })}
                      statusMap={selectionStatusMap}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                  <div className="w-24 h-24 border-2 border-dashed border-zinc-700 rounded-[2rem] flex items-center justify-center">
                    <FileCode className="w-10 h-10" />
                  </div>
                  <p className="text-sm font-medium">Ready for input...</p>
                </div>
              )}
            </div>

            <div className="p-6 bg-white/[0.01] border-t border-white/5">
              <button 
                onClick={generateOutput}
                disabled={isGenerating || !treeData}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-indigo-500/10 active:scale-[0.98] flex items-center justify-center gap-3"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                Generate Context Bundle
              </button>
            </div>
          </div>

          {/* Preview Column */}
          <div className="lg:col-span-7 bg-zinc-900/30 rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden backdrop-blur-sm">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-emerald-500/10 rounded-xl">
                  <Filter className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Output Preview</span>
              </div>
              {output && (
                <div className="flex gap-3 bg-black/40 p-1.5 rounded-2xl border border-white/5">
                  <select 
                    className="bg-transparent border-none text-[10px] font-bold rounded-lg px-2 outline-none cursor-pointer text-zinc-400"
                    value={downloadFormat}
                    onChange={(e) => setDownloadFormat(e.target.value as any)}
                  >
                    <option value="txt" className="bg-zinc-900 text-white">TXT</option>
                    <option value="md" className="bg-zinc-900 text-white">MARKDOWN</option>
                    <option value="pdf" className="bg-zinc-900 text-white">PDF</option>
                  </select>
                  <div className="w-px h-4 bg-white/10 self-center" />
                  <button onClick={handleCopy} className="p-2 hover:bg-white/10 rounded-xl transition-all group relative">
                    {copyFeedback ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-400 group-hover:text-white" />}
                  </button>
                  <button onClick={handleDownload} className="flex items-center gap-2 bg-white text-black text-[10px] font-black px-4 py-1.5 rounded-xl hover:bg-zinc-200 transition-all">
                    <Download className="w-3.5 h-3.5" /> EXPORT
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 p-0 relative group">
              <textarea 
                readOnly
                className="w-full h-full p-8 bg-transparent text-[12px] font-mono text-indigo-100/60 leading-relaxed resize-none outline-none custom-scrollbar selection:bg-indigo-500/50"
                placeholder="// Bundle contents will appear here after generation..."
                value={output}
              />
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </div>
      
      {error && (
        <div className="fixed bottom-10 right-10 bg-red-500/90 backdrop-blur-md text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-4 animate-in slide-in-from-right-10 duration-500 border border-white/10">
          <AlertCircle className="w-6 h-6" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-black tracking-widest opacity-60">System Alert</span>
            <span className="text-sm font-bold">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="ml-4 p-1 hover:bg-white/10 rounded-full"><X className="w-5 h-5" /></button>
        </div>
      )}
    </div>
  );
};

export default App;
