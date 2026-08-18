import React, { useState, useEffect, useRef } from 'react';

export default function InputModal({
  isOpen,
  title = '请输入',
  hint = '',
  defaultValue = '',
  placeholder = '请输入内容...',
  inputType = 'text',
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue || '');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 60);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-3 sm:p-4 animate-fade-in backdrop-blur-sm">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl scale-in">
        <div className="px-5 py-4 border-b border-borderColor bg-white/5 flex items-center justify-between">
          <div>
            <h3 className="text-textPrimary text-base font-semibold">{title}</h3>
            {hint && <p className="text-textMuted text-xs mt-1 leading-relaxed">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-textMuted hover:text-textPrimary transition-colors"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex-1 overflow-y-auto flex flex-col gap-4">
          <input
            ref={inputRef}
            type={inputType}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3.5 py-2.5 rounded-xl bg-bgPrimary border border-borderColor text-sm text-textPrimary focus:outline-none focus:border-accentColor transition-all placeholder:text-textMuted/60"
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-textSecondary hover:bg-white/5 transition-all border border-borderColor"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-accentColor hover:bg-accentHover text-white transition-all shadow-md shadow-accentColor/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
