import React from 'react';

export default function ConfirmModal({ isOpen, title, message, onOk, onCancel, confirmText = 'Yes, Delete', cancelText = 'Cancel', isDanger = true, customActions = null }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in backdrop-blur-sm">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-sm max-h-[85vh] flex flex-col overflow-hidden shadow-2xl scale-in">
        <div className="p-6 text-center flex-1 overflow-y-auto">
          <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center text-xl mb-4 ${isDanger ? 'bg-red-500/10 text-red-500' : 'bg-accentColor/10 text-accentColor'}`}>
            <i className="fa-solid fa-circle-exclamation"></i>
          </div>
          <h3 className="text-textPrimary text-lg font-semibold mb-2">{title}</h3>
          <p className="text-textSecondary text-sm">{message}</p>
        </div>
        {customActions && customActions.length > 0 ? (
          <div className="flex flex-col gap-2 p-4 border-t border-borderColor">
            {customActions.map((action, idx) => (
              <button
                key={idx}
                className="py-3 text-sm font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
            <button
              className="py-3 text-sm font-medium text-textSecondary hover:bg-white/5 transition-colors"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          </div>
        ) : (
          <div className="flex border-t border-borderColor">
            <button 
              className="flex-1 py-3 text-sm font-medium text-textSecondary hover:bg-white/5 transition-colors border-r border-borderColor"
              onClick={onCancel}
            >
              {cancelText}
            </button>
            <button 
              className={`flex-1 py-3 text-sm font-semibold transition-colors hover:bg-white/5 ${isDanger ? 'text-red-500' : 'text-accentColor'}`}
              onClick={onOk}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
