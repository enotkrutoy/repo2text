
import React, { useMemo } from 'react';
import { TreeNode, SelectionState } from '../types';
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
  selection: SelectionState;
  onToggle: (path: string, isFile: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg']);

const FileTree: React.FC<FileTreeProps> = React.memo(({ 
  node, 
  selection, 
  onToggle, 
  expandedPaths, 
  onToggleExpand 
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'tree' || (node.children && Object.keys(node.children).length > 0);
  
  const sortedChildren = useMemo(() => {
    if (!node.children) return [];
    return (Object.entries(node.children) as [string, TreeNode][]).sort(([aName, aNode], [bName, bNode]) => {
      const aIsDir = aNode.type === 'tree' || !!aNode.children;
      const bIsDir = bNode.type === 'tree' || !!bNode.children;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return aName.localeCompare(bName);
    });
  }, [node.children]);

  const getSelectionStatus = (n: TreeNode): 'checked' | 'unchecked' | 'indeterminate' => {
    if (n.type === 'blob') {
      return selection[n.path] ? 'checked' : 'unchecked';
    }
    if (!n.children || Object.keys(n.children).length === 0) return 'unchecked';
    const childrenArr = Object.values(n.children) as TreeNode[];
    const statuses = childrenArr.map(child => getSelectionStatus(child));
    const allChecked = statuses.every(s => s === 'checked');
    const allUnchecked = statuses.every(s => s === 'unchecked');
    if (allChecked) return 'checked';
    if (allUnchecked) return 'unchecked';
    return 'indeterminate';
  };

  const status = getSelectionStatus(node);

  const renderSelectionIcon = () => {
    switch (status) {
      case 'checked': return <CheckSquare className="w-4 h-4 text-blue-400 mr-2 shrink-0" />;
      case 'indeterminate': return <MinusSquare className="w-4 h-4 text-blue-400 mr-2 shrink-0" />;
      default: return <Square className="w-4 h-4 text-slate-500 mr-2 shrink-0" />;
    }
  };

  const getFileIcon = () => {
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    if (IMAGE_EXTENSIONS.has(ext)) return <ImageIcon className="w-4 h-4 mr-2 text-pink-400 shrink-0" />;
    return <File className="w-4 h-4 mr-2 text-blue-300 shrink-0" />;
  };

  return (
    <div className="select-none">
      <div 
        className="flex items-center py-1.5 hover:bg-slate-700/50 rounded transition-all px-1 group cursor-pointer"
        onClick={() => isDirectory ? onToggleExpand(node.path) : null}
      >
        {/* Selection Trigger */}
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path, !isDirectory);
          }} 
          className="flex items-center p-1 hover:bg-slate-600 rounded transition-colors"
        >
           {renderSelectionIcon()}
        </div>
        
        {/* Content Area */}
        <div className="flex items-center flex-1 min-w-0">
          {isDirectory && (
            <span className="mr-1 text-slate-500 group-hover:text-blue-400 transition-colors">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          )}
          {!isDirectory && <span className="w-5" />}
          
          {isDirectory ? (
            <Folder className={`w-4 h-4 mr-2 shrink-0 transition-colors ${isExpanded ? 'text-blue-400' : 'text-amber-400'}`} />
          ) : (
            getFileIcon()
          )}
          
          <span className={`text-sm truncate ${isDirectory ? 'font-semibold text-slate-200' : 'text-slate-300'}`}>
            {node.name}
          </span>
        </div>
      </div>

      {isDirectory && isExpanded && (
        <div className="ml-4 border-l border-slate-800/80 pl-1 mt-0.5 animate-in fade-in slide-in-from-left-1 duration-200">
          {sortedChildren.map(([name, childNode]) => (
            <FileTree 
              key={childNode.path} 
              node={childNode} 
              selection={selection} 
              onToggle={onToggle}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default FileTree;
