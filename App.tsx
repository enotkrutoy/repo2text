
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  Search, 
  Github, 
  Info, 
  ExternalLink, 
  Copy, 
  Download, 
  FileText,
  AlertCircle,
  Loader2,
  ChevronRight,
  FileCode,
  Type,
  Image as ImageIcon,
  Key
} from 'lucide-react';
import { 
  parseRepoUrl, 
  fetchRepoSha, 
  fetchRepoTree, 
  fetchFileContents, 
  sortTreeItems,
  fetchRepoInfo
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
    return children
      .map((child, i) => buildAsciiIndex(child, '', i === children.length - 1))
      .join('');
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

const formatRepoOutput = (contents: FileContent[], tree: TreeNode, format: 'txt' | 'md', repoDetails?: RepoDetails): string => {
  const sorted = sortTreeItems(contents);
  const index = buildAsciiIndex(tree);
  
  if (format === 'md') {
    let output = `# Repository: ${repoDetails?.owner}/${repoDetails?.repo}\n\n`;
    output += `## Directory Structure\n\n\`\`\`text\n${index}\n\`\`\`\n\n`;
    output += `## Files\n`;
    sorted.forEach(file => {
      if (file.type === 'image' && file.dataUrl) {
        output += `\n### File: ${file.path}\n\n![${file.path}](${file.dataUrl})\n`;
      } else if (file.type === 'text') {
        const ext = file.path.split('.').pop() || '';
        output += `\n### File: ${file.path}\n\n\`\`\`${ext}\n${file.text}\n\`\`\`\n`;
      }
    });
    return output;
  }

  let output = `REPOSITORY: ${repoDetails?.owner}/${repoDetails?.repo}\n`;
  output += `STRUCTURE:\n\n${index}\n\n`;
  sorted.forEach(file => {
    if (file.type === 'text') {
      output += `\n---\nFILE: ${file.path}\n---\n\n${file.text}\n`;
    } else {
      output += `\n---\nFILE: ${file.path} (Image Content: ${file.mimeType})\n---\n`;
    }
  });
  return output;
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
  const [fetchedContents, setFetchedContents] = useState<FileContent[]>([]);

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
    setFetchedContents([]);

    try {
      const details = parseRepoUrl(repoUrl);
      setActiveRepoDetails(details);
      let targetSha = '';
      if (!details.path) {
         const repoInfo = await fetchRepoInfo(details.owner, details.repo, token);
         const branch = details.ref || repoInfo.default_branch;
         targetSha = await fetchRepoSha(details.owner, details.repo, branch, '', token);
      } else {
         targetSha = await fetchRepoSha(details.owner, details.repo, details.ref, details.path, token);
      }
      const items = await fetchRepoTree(details.owner, details.repo, targetSha, token);
      const root = buildTree(items);
      setTreeData(root);

      const initialSelection: SelectionState = {};
      const initialExpansion = new Set<string>(['']);
      items.forEach(item => {
        if (item.type === 'blob') {
          const ext = item.path.split('.').pop()?.toLowerCase() || '';
          initialSelection[item.path] = COMMON_EXTENSIONS.has(ext);
        } else {
          if (item.path.split('/').length < 2) initialExpansion.add(item.path);
        }
      });
      setSelection(initialSelection);
      setExpandedPaths(initialExpansion);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching the repository.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = useCallback((path: string, isFile: boolean) => {
    setSelection(prev => {
      const newState = { ...prev };
      if (isFile) {
        newState[path] = !prev[path];
      } else {
        const isCurrentlySelected = Object.keys(prev)
          .filter(p => p === path || p.startsWith(path + '/'))
          .every(p => prev[p]);
        
        const toggleChildren = (node: TreeNode, targetValue: boolean) => {
          if (node.type === 'blob') newState[node.path] = targetValue;
          if (node.children) Object.values(node.children).forEach(child => toggleChildren(child, targetValue));
        };

        const findAndToggle = (node: TreeNode) => {
          if (node.path === path) {
            toggleChildren(node, !isCurrentlySelected);
            return true;
          }
          if (node.children) return Object.values(node.children).some(child => findAndToggle(child));
          return false;
        };
        if (treeData) findAndToggle(treeData);
      }
      return newState;
    });
  }, [treeData]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const generateOutput = async () => {
    if (!treeData) return;
    setIsGenerating(true);
    try {
      const filesToFetch: { path: string, url: string }[] = [];
      const traverse = (node: TreeNode) => {
        if (node.type === 'blob' && selection[node.path]) filesToFetch.push({ path: node.path, url: node.url });
        if (node.children) Object.values(node.children).forEach(traverse);
      };
      traverse(treeData);
      if (filesToFetch.length === 0) { setError('Please select at least one file.'); return; }
      
      const contents = await fetchFileContents(filesToFetch, token);
      setFetchedContents(contents);
      const formatted = formatRepoOutput(contents, treeData, downloadFormat === 'pdf' ? 'txt' : downloadFormat, activeRepoDetails || undefined);
      setOutput(formatted);
    } catch (err: any) {
      setError(err.message || 'Failed to generate output.');
    } finally { setIsGenerating(false); }
  };

  const generatePremiumPDF = async () => {
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const addFooter = (pageNum: number, total: number) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`RepoPacker | ${activeRepoDetails?.repo} | Page ${pageNum} of ${total}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    };

    // Cover Page
    doc.setFillColor(15, 23, 42); 
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text('REPOSITORY SOURCE', pageWidth / 2, 80, { align: 'center' });
    doc.setFontSize(14);
    doc.setTextColor(148, 163, 184); 
    doc.text('Optimized Source Bundle for AI Context', pageWidth / 2, 95, { align: 'center' });
    doc.setDrawColor(59, 130, 246); 
    doc.setLineWidth(2);
    doc.line(pageWidth / 4, 110, (pageWidth / 4) * 3, 110);
    doc.setFontSize(20);
    doc.setTextColor(255);
    doc.text(`${activeRepoDetails?.owner} / ${activeRepoDetails?.repo}`, pageWidth / 2, 130, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 30, { align: 'center' });
    
    doc.addPage();
    doc.setTextColor(30, 41, 59);

    y = 25;
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Directory Structure', margin, y);
    y += 12;
    
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const indexStr = buildAsciiIndex(treeData!);
    const indexLines = doc.splitTextToSize(indexStr, contentWidth);
    indexLines.forEach((line: string) => {
      if (y > pageHeight - 20) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 4.5;
    });
    
    const sorted: FileContent[] = sortTreeItems(fetchedContents);
    sorted.forEach((file) => {
      doc.addPage();
      y = 25;
      doc.setFillColor(241, 245, 249); 
      doc.rect(margin - 5, y - 8, contentWidth + 10, 12, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(37, 99, 235); 
      doc.text(`FILE: ${file.path}`, margin, y);
      y += 15;

      if (file.type === 'image' && file.dataUrl) {
        try {
          const img = new Image();
          img.src = file.dataUrl;
          const ratio = img.height / img.width;
          let displayWidth = contentWidth;
          let displayHeight = contentWidth * ratio;
          if (displayHeight > 150) { displayHeight = 150; displayWidth = displayHeight / ratio; }
          doc.addImage(file.dataUrl, 'JPEG', margin + (contentWidth - displayWidth)/2, y, displayWidth, displayHeight, undefined, 'MEDIUM');
          y += displayHeight + 10;
        } catch (e) {
          doc.setFont('helvetica', 'italic');
          doc.text('[Image rendering skipped]', margin, y);
        }
      } else if (file.type === 'text' && file.text) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(30, 41, 59);
        const codeLines = doc.splitTextToSize(file.text, contentWidth);
        codeLines.forEach((line: string) => {
          if (y > pageHeight - 20) { doc.addPage(); y = 20; }
          doc.text(line, margin, y);
          y += 4.2;
        });
      }
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 2; i <= totalPages; i++) {
      doc.setPage(i);
      addFooter(i, totalPages);
    }
    doc.save(`${activeRepoDetails?.owner}-${activeRepoDetails?.repo}-context.pdf`);
  };

  const handleDownload = () => {
    if (!output && downloadFormat !== 'pdf') return;
    if (downloadFormat === 'pdf') { generatePremiumPDF(); return; }
    const nameBase = activeRepoDetails ? `${activeRepoDetails.owner}-${activeRepoDetails.repo}` : 'repo-context';
    const blob = new Blob([output], { type: downloadFormat === 'md' ? 'text/markdown' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nameBase}-context.${downloadFormat}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8 selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-800 pb-8">
          <div className="flex items-center gap-5">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-3 rounded-2xl shadow-2xl shadow-blue-500/20 ring-1 ring-white/10">
              <Github className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">RepoPacker</h1>
              <p className="text-slate-500 text-sm font-medium flex items-center gap-2 mt-1">
                <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse"></span>
                Instant AI Context Generation
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                  <Key className="w-4 h-4" />
                </div>
                <input 
                  type="password"
                  placeholder="Personal Access Token (ghp_...)"
                  className="bg-slate-900/50 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-slate-300 placeholder:text-slate-600 backdrop-blur-md"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button 
                  onMouseEnter={() => setShowTokenInfo(true)}
                  onMouseLeave={() => setShowTokenInfo(false)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                >
                  <Info className="w-4 h-4" />
                </button>
                {showTokenInfo && (
                  <div className="absolute top-full right-0 mt-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 w-80 text-xs text-slate-400 leading-relaxed backdrop-blur-xl animate-in zoom-in-95 duration-200">
                    <p className="font-bold mb-2 text-blue-400 flex items-center gap-2 uppercase">
                      <AlertCircle className="w-3 h-3" /> Rate Limits
                    </p>
                    <p>Без токена GitHub ограничивает вас до 60 запросов в час. С токеном — до 5000. Токен сохраняется только в вашем браузере (localStorage).</p>
                  </div>
                )}
             </div>
          </div>
        </header>

        <section className="bg-slate-900/40 p-1 rounded-2xl border border-slate-800 shadow-2xl backdrop-blur-sm">
          <form onSubmit={handleFetch} className="flex flex-col md:flex-row gap-2">
            <div className="flex-1 relative group p-2">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" 
                placeholder="https://github.com/owner/repository"
                className="w-full bg-slate-950/50 border border-slate-800 rounded-xl pl-14 pr-6 py-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-slate-200 shadow-inner"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <button 
              type="submit"
              disabled={isLoading}
              className="m-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-10 py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-blue-600/20"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Github className="w-5 h-5" />}
              Fetch Directory
            </button>
          </form>
          {error && (
            <div className="mx-4 mb-4 p-4 bg-red-950/30 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 animate-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[800px]">
          <section className="bg-slate-900/20 rounded-3xl border border-slate-800/60 flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <FileCode className="w-5 h-5 text-blue-500" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Source Explorer</h2>
              </div>
              {treeData && (
                <div className="flex items-center gap-3">
                  <select 
                    value={downloadFormat}
                    onChange={(e) => setDownloadFormat(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 text-[10px] font-bold rounded-lg px-3 py-1.5 text-slate-400 uppercase cursor-pointer"
                  >
                    <option value="txt">.txt Plain</option>
                    <option value="md">.md Markdown</option>
                    <option value="pdf">.pdf Premium</option>
                  </select>
                  <button 
                    onClick={generateOutput}
                    disabled={isGenerating}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-black px-5 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-90"
                  >
                    {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                    PACK BUNDLE
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-950/20">
              {!treeData && !isLoading && (
                <div className="h-full flex flex-col items-center justify-center text-slate-800 space-y-6">
                  <FileCode className="w-24 h-24 opacity-5 stroke-[0.5px]" />
                  <p className="text-[10px] font-bold opacity-20 uppercase tracking-[0.3em]">No Repository Loaded</p>
                </div>
              )}
              {treeData && (
                <div className="space-y-0.5">
                  {(Object.values(treeData.children || {}) as TreeNode[]).map(node => (
                    <FileTree 
                      key={node.path}
                      node={node}
                      selection={selection}
                      onToggle={handleToggle}
                      expandedPaths={expandedPaths}
                      onToggleExpand={handleToggleExpand}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="bg-slate-900/20 rounded-3xl border border-slate-800/60 flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <Type className="w-5 h-5 text-emerald-500" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Output Preview</h2>
              </div>
              {(output || fetchedContents.length > 0) && (
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => { navigator.clipboard.writeText(output); }}
                    className="p-2.5 bg-slate-900 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-white transition-all border border-slate-800"
                    title="Copy to Clipboard"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button 
                    className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black px-6 py-2.5 rounded-xl flex items-center gap-3 transition-all shadow-lg shadow-blue-600/20 active:scale-90"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4" />
                    EXPORT {downloadFormat.toUpperCase()}
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-hidden relative bg-slate-950/60">
              {output ? (
                <textarea 
                  readOnly 
                  className="w-full h-full bg-transparent p-8 font-mono text-[11px] text-slate-500 resize-none focus:outline-none custom-scrollbar leading-relaxed selection:bg-blue-600/40 border-none outline-none"
                  value={output}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-800 space-y-6">
                  <ImageIcon className="w-24 h-24 opacity-5 stroke-[0.5px]" />
                  <p className="text-[10px] font-bold opacity-20 uppercase tracking-[0.3em]">Output Empty</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default App;
