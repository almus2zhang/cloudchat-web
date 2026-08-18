import React, { useState } from 'react';

// 递归渲染文件夹树节点
function FolderTreeNode({ folder, allMessages, selectedId, onSelect, depth = 0, excludeIds = new Set() }) {
  const [expanded, setExpanded] = useState(false);
  const children = allMessages.filter(m => m.type === 'FOLDER' && !m.isDeleted && m.folderId === folder.id);
  const disabled = excludeIds.has(folder.id);
  const isSelected = selectedId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          disabled ? 'opacity-40 cursor-not-allowed' : ''
        } ${isSelected ? 'bg-cyan-500/20 border border-cyan-500/40' : 'hover:bg-white/5'}`}
        onClick={() => { if (!disabled) onSelect(folder.id); }}
      >
        {children.length > 0 ? (
          <button
            className="w-5 h-5 flex items-center justify-center text-textMuted hover:text-textPrimary"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <i className={`fa-solid ${expanded ? 'fa-caret-down' : 'fa-caret-right'}`}></i>
          </button>
        ) : (
          <span className="w-5"></span>
        )}
        <i className="fa-solid fa-folder text-cyan-500"></i>
        <span className="text-sm text-textPrimary truncate">{folder.content || '文件夹'}</span>
      </div>
      {expanded && children.length > 0 && (
        <div className="ml-5 border-l border-borderColor">
          {children.map(child => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              allMessages={allMessages}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
              excludeIds={excludeIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FolderPickerModal({
  isOpen,
  title = '选择文件夹',
  hint = '',
  allMessages = [],
  currentFolderId = null,
  excludeIds = new Set(),
  confirmText = '移入',
  directItems = null,
  onConfirm,
  onCancel
}) {
  const [selectedId, setSelectedId] = useState(null);

  // directItems 模式：直接显示给定文件夹列表（用于选择父文件夹）；
  // 否则从 home（根目录）列出完整文件夹树（顶层文件夹 folderId 为空）
  const rootFolders = directItems != null
    ? directItems.filter(m => m.type === 'FOLDER' && !m.isDeleted)
    : allMessages.filter(m => m.type === 'FOLDER' && !m.isDeleted && !m.folderId);

  // 当弹窗打开时重置选中
  React.useEffect(() => {
    if (isOpen) setSelectedId(null);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in backdrop-blur-sm">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl scale-in">
        <div className="p-5 border-b border-borderColor bg-white/5">
          <h3 className="text-textPrimary text-lg font-semibold">{title}</h3>
          {hint && <p className="text-textMuted text-xs mt-1">{hint}</p>}
        </div>
        <div className="p-3 flex-1 max-h-[60vh] overflow-y-auto">
          {rootFolders.length === 0 ? (
            <p className="text-textMuted text-sm text-center py-6">还没有任何文件夹，请先打包创建文件夹</p>
          ) : (
            rootFolders.map(folder => (
              <FolderTreeNode
                key={folder.id}
                folder={folder}
                allMessages={allMessages}
                selectedId={selectedId}
                onSelect={setSelectedId}
                excludeIds={excludeIds}
              />
            ))
          )}
        </div>
        <div className="flex border-t border-borderColor">
          <button
            className="flex-1 py-3 text-sm font-medium text-textSecondary hover:bg-white/5 transition-colors border-r border-borderColor"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="flex-1 py-3 text-sm font-semibold text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!selectedId}
            onClick={() => selectedId && onConfirm(selectedId)}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
