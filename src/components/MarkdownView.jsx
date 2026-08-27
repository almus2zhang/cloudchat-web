import React from 'react';

/**
 * Lightweight and fast Markdown renderer for CloudChat Web/Desktop
 * Supports: Headers (###), Bold (**text**), Lists (- item), Blockquotes (> text), Code blocks, Line breaks
 */
export default function MarkdownView({ content, isOutgoing = false, className = '' }) {
  if (!content) return null;

  // Strip leading <!--md--> or [MD] prefix
  const rawText = content.replace(/^<!--md-->/, '').replace(/^\[MD\]/, '').trim();

  // Parse lines into structured blocks
  const lines = rawText.split('\n');
  const elements = [];
  let inList = false;
  let listItems = [];
  let keyIndex = 0;

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${keyIndex++}`} className="list-disc pl-5 my-1.5 space-y-1">
          {listItems.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it, isOutgoing)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Header 3 or 4: ### Header or #### Header
    if (trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
      flushList();
      const text = trimmed.replace(/^#+\s*/, '');
      elements.push(
        <h4 key={`h-${keyIndex++}`} className="font-bold text-[14.5px] mt-2 mb-1 opacity-95 flex items-center gap-1.5">
          {renderInline(text, isOutgoing)}
        </h4>
      );
    }
    // Header 1 or 2: # Header or ## Header
    else if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
      flushList();
      const text = trimmed.replace(/^#+\s*/, '');
      elements.push(
        <h3 key={`h-${keyIndex++}`} className="font-bold text-[15.5px] mt-2.5 mb-1.5 opacity-100 flex items-center gap-1.5">
          {renderInline(text, isOutgoing)}
        </h3>
      );
    }
    // Blockquote: > text
    else if (trimmed.startsWith('> ')) {
      flushList();
      const text = trimmed.replace(/^>\s*/, '');
      elements.push(
        <blockquote 
          key={`quote-${keyIndex++}`} 
          className={`border-l-2 pl-2.5 py-0.5 my-1 text-xs italic ${
            isOutgoing ? 'border-white/60 text-white/90 bg-white/10 rounded-r' : 'border-accentColor/60 text-textSecondary bg-black/5 dark:bg-white/5 rounded-r'
          }`}
        >
          {renderInline(text, isOutgoing)}
        </blockquote>
      );
    }
    // List item: - item or * item
    else if (/^[-*]\s+/.test(trimmed)) {
      inList = true;
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
    }
    // Regular paragraph
    else {
      flushList();
      elements.push(
        <p key={`p-${keyIndex++}`} className="my-1 leading-relaxed text-[13.5px]">
          {renderInline(trimmed, isOutgoing)}
        </p>
      );
    }
  }

  flushList();

  return (
    <div className={`markdown-body select-text space-y-0.5 ${className}`}>
      {elements}
    </div>
  );
}

function renderInline(text, isOutgoing) {
  if (!text) return null;

  // Split by bold (**text**)
  const parts = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIdx = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`bold-${idx++}`} className="font-bold opacity-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code 
          key={`code-${idx++}`} 
          className={`px-1 py-0.5 text-xs font-mono rounded ${
            isOutgoing ? 'bg-black/30 text-amber-200' : 'bg-black/10 dark:bg-white/10 text-indigo-500 dark:text-indigo-300'
          }`}
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts;
}
