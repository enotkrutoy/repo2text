
import React, { useMemo } from 'react';
import { TreeNode, SelectionStatus } from '../types';
import { 
  ChevronDown, 
  ChevronRight, 
  Folder, 
  File, 
  Image as ImageIcon,
  CheckSquare, 
  Square,
  MinusSquare
} from 'lucide-react';

interface FileTreeProps {
  node: TreeNode;
  status: SelectionStatus;
  onToggle: (path: string, isFile: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  statusMap: Record<string, SelectionStatus>;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg']);

const FileTree: React.FC<FileTreeProps> = React.memo(({ 
  node, 
  status, 
  onToggle, 
  expandedPaths, 
  onToggleExpand,
  statusMap
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'tree';
  
  const sortedChildren = useMemo(() => {
    if (!node.children) return [];
    return (Object.entries(node.children) as [string, TreeNode][]).sort(([aName, aNode], [bName, bNode]) => {
      const aIsDir = aNode.type === 'tree';
      const bIsDir = bNode.type === 'tree';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return aName.localeCompare(bName);
    });
  }, [node.children]);

  const renderSelectionIcon = () => {
    switch (status) {
      case 'checked': return <CheckSquare className="w-4 h-4 text-indigo-400 mr-2 shrink-0" />;
      case 'indeterminate': return <MinusSquare className="w-4 h-4 text-indigo-400/60 mr-2 shrink-0" />;
      default: return <Square className="w-4 h-4 text-slate-600 mr-2 shrink-0" />;
    }
  };

  const getFileIcon = () => {
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    if (IMAGE_EXTENSIONS.has(ext)) return <ImageIcon className="w-4 h-4 mr-2 text-pink-500/80 shrink-0" />;
    return <File className="w-4 h-4 mr-2 text-indigo-300/70 shrink-0" />;
  };

  return (
    <div className="select-none">
      <div 
        className="flex items-center py-1.5 hover:bg-white/5 rounded-xl transition-all px-2 group cursor-pointer"
        onClick={() => isDirectory ? onToggleExpand(node.path) : null}
      >
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path, !isDirectory);
          }} 
          className="flex items-center p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
           {renderSelectionIcon()}
        </div>
        
        <div className="flex items-center flex-1 min-w-0 ml-1">
          {isDirectory && (
            <span className="mr-1.5 text-slate-500 group-hover:text-indigo-400 transition-colors">
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          )}
          {!isDirectory && <span className="w-5" />}
          
          {isDirectory ? (
            <Folder className={`w-4 h-4 mr-2 shrink-0 transition-all ${isExpanded ? 'text-indigo-400 fill-indigo-400/10' : 'text-amber-500/80'}`} />
          ) : (
            getFileIcon()
          )}
          
          <span className={`text-[13px] truncate ${isDirectory ? 'font-medium text-slate-200' : 'text-slate-400'}`}>
            {node.name}
          </span>
        </div>
      </div>

      {isDirectory && isExpanded && (
        <div className="ml-5 border-l border-white/5 pl-2 mt-0.5 space-y-0.5">
          {sortedChildren.map(([name, childNode]) => (
            <FileTree 
              key={childNode.path} 
              node={childNode} 
              status={statusMap[childNode.path] || 'unchecked'}
              onToggle={onToggle}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              statusMap={statusMap}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default FileTree;
