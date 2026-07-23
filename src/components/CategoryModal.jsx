import React, { useState, useEffect } from 'react';

const CATEGORY_MAP = {
    'diary': '日记',
    'transfer': '传输',
    'work': '工作',
    'privacy': '隐私'
};
const CATEGORY_MAP_REV = {
    '日记': 'diary',
    '传输': 'transfer',
    '工作': 'work',
    '隐私': 'privacy'
};

export default function CategoryModal({ isOpen, messages, onSave, onCancel }) {
  const [selectedOpt, setSelectedOpt] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    if (!isOpen) return;

    // Scan all unique existing category IDs from messages
    const existingCats = new Set();
    messages.forEach(m => {
      if (m.categories) {
        m.categories.forEach(catId => {
          // Normalize
          const normalized = CATEGORY_MAP_REV[catId] || catId;
          if (normalized) existingCats.add(normalized);
        });
      }
    });
    // Add default category IDs
    ['diary', 'transfer', 'work', 'privacy'].forEach(c => existingCats.add(c));
    
    // Sort stably: defaults first, custom ones alphabetically
    const defaultIds = ['diary', 'transfer', 'work', 'privacy'];
    const sorted = Array.from(existingCats).sort((a, b) => {
        const idxA = defaultIds.indexOf(a);
        const idxB = defaultIds.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    setCategories(sorted);
    if (sorted.length > 0) {
      setSelectedOpt(sorted[0]);
    }
    setNewCatName('');
  }, [isOpen, messages]);

  if (!isOpen) return null;

  const handleSave = () => {
    let result = selectedOpt;
    if (selectedOpt === '--new--') {
      result = newCatName.trim();
    }
    if (!result) return;

    // Map Chinese names back to standard IDs if they match
    const catId = CATEGORY_MAP_REV[result] || result;
    onSave(catId);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-xl w-full max-w-sm overflow-hidden shadow-2xl scale-in">
        <div className="p-6 border-b border-borderColor">
          <h2 className="text-textPrimary font-semibold text-lg">Choose Category</h2>
        </div>
        
        <div className="p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">Select Category</label>
            <select 
              value={selectedOpt} 
              onChange={(e) => setSelectedOpt(e.target.value)}
              className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
            >
              {categories.map(catId => (
                <option key={catId} value={catId}>
                  {CATEGORY_MAP[catId] || catId}
                </option>
              ))}
              <option value="--new--">New Category...</option>
            </select>
          </div>

          {selectedOpt === '--new--' && (
            <div className="flex flex-col gap-1.5 animate-slide-down">
              <label className="text-xs font-medium text-textSecondary uppercase tracking-wider">New Category Name</label>
              <input 
                type="text" 
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Enter new category name"
                className="bg-bgPrimary text-textPrimary border border-borderColor rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accentColor transition-colors w-full"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-bgPrimary/30 border-t border-borderColor flex justify-end gap-3">
          <button 
            className="px-4 py-2 text-sm font-medium text-textSecondary hover:bg-white/5 rounded-lg transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button 
            className="px-5 py-2 text-sm font-semibold text-white bg-accentColor hover:bg-accentHover rounded-lg transition-colors shadow-lg shadow-accentColor/10"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
