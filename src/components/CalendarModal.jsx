import React, { useState, useMemo } from 'react';

export default function CalendarModal({ isOpen, onClose, messages = [], onSelectDate }) {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0 - 11

  // Extract set of YYYY-MM-DD dates that have messages
  const datesWithMessagesMap = useMemo(() => {
    const map = new Map(); // dateStr -> count
    messages.forEach(msg => {
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        map.set(dateStr, (map.get(dateStr) || 0) + 1);
      }
    });
    return map;
  }, [messages]);

  if (!isOpen) return null;

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handleToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // Calendar matrix calculation
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun, 1 = Mon, ...
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  // Years option (from earliest message year to current year + 1)
  const availableYears = [];
  const startYear = Math.min(2020, currentYear - 5);
  const endYear = Math.max(today.getFullYear() + 2, currentYear + 2);
  for (let y = startYear; y <= endYear; y++) {
    availableYears.push(y);
  }

  // Generate calendar grid cells
  const gridCells = [];
  // Empty padding cells for start of month
  for (let i = 0; i < firstDayOfWeek; i++) {
    gridCells.push({ key: `pad-${i}`, dayNum: null });
  }
  // Days of month
  for (let d = 1; d <= daysInMonth; d++) {
    const mmStr = String(currentMonth + 1).padStart(2, '0');
    const ddStr = String(d).padStart(2, '0');
    const dateStr = `${currentYear}-${mmStr}-${ddStr}`;
    const msgCount = datesWithMessagesMap.get(dateStr) || 0;
    gridCells.push({
      key: `day-${d}`,
      dayNum: d,
      dateStr,
      msgCount,
      hasMessages: msgCount > 0,
      isToday: dateStr === todayStr
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-borderColor bg-bgPrimary/50">
          <div className="flex items-center gap-1.5">
            <i className="fa-regular fa-calendar-days text-accentColor text-base"></i>
            <h3 className="text-sm font-semibold text-textPrimary">日历跳转</h3>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bgPrimary text-textMuted hover:text-textPrimary transition-all"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {/* Controls: Year / Month Selection */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-bgPrimary/30">
          <button
            onClick={handlePrevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bgPrimary text-textPrimary transition-all"
            title="上个月"
          >
            <i className="fa-solid fa-chevron-left text-xs"></i>
          </button>

          <div className="flex items-center gap-1.5">
            {/* Year Selector */}
            <select
              value={currentYear}
              onChange={(e) => setCurrentYear(Number(e.target.value))}
              className="bg-bgPrimary border border-borderColor text-textPrimary text-xs font-semibold rounded-md px-2 py-1 focus:outline-none focus:border-accentColor cursor-pointer"
            >
              {availableYears.map(y => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>

            {/* Month Selector */}
            <select
              value={currentMonth}
              onChange={(e) => setCurrentMonth(Number(e.target.value))}
              className="bg-bgPrimary border border-borderColor text-textPrimary text-xs font-semibold rounded-md px-2 py-1 focus:outline-none focus:border-accentColor cursor-pointer"
            >
              {monthNames.map((m, idx) => (
                <option key={idx} value={idx}>{m}</option>
              ))}
            </select>

            <button
              onClick={handleToday}
              className="px-2 py-1 text-[11px] font-medium bg-accentColor/10 text-accentColor border border-accentColor/30 rounded-md hover:bg-accentColor/20 transition-all ml-1"
            >
              今
            </button>
          </div>

          <button
            onClick={handleNextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bgPrimary text-textPrimary transition-all"
            title="下个月"
          >
            <i className="fa-solid fa-chevron-right text-xs"></i>
          </button>
        </div>

        {/* Week Header */}
        <div className="grid grid-cols-7 gap-1 px-3 pt-2 text-center text-[11px] font-semibold text-textMuted border-b border-borderColor/40 pb-1">
          <span className="text-red-400">日</span>
          <span>一</span>
          <span>二</span>
          <span>三</span>
          <span>四</span>
          <span>五</span>
          <span className="text-accentColor">六</span>
        </div>

        {/* Calendar Days Grid */}
        <div className="grid grid-cols-7 gap-1 p-3">
          {gridCells.map((cell) => {
            if (!cell.dayNum) {
              return <div key={cell.key} className="h-10"></div>;
            }

            return (
              <button
                key={cell.key}
                disabled={!cell.hasMessages}
                onClick={() => {
                  if (cell.hasMessages && onSelectDate) {
                    onSelectDate(cell.dateStr);
                    onClose();
                  }
                }}
                title={cell.hasMessages ? `${cell.dateStr} (${cell.msgCount} 条信息)` : cell.dateStr}
                className={`h-10 rounded-xl flex flex-col items-center justify-center relative transition-all ${
                  cell.isToday ? 'border border-accentColor font-bold' : ''
                } ${
                  cell.hasMessages 
                    ? 'hover:bg-accentColor/15 hover:scale-105 cursor-pointer text-textPrimary font-medium' 
                    : 'opacity-35 cursor-not-allowed text-textMuted'
                }`}
              >
                <span className="text-xs leading-none">{cell.dayNum}</span>
                
                {/* Red/Accent indicator dot for days with entries */}
                {cell.hasMessages && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accentColor mt-1 shadow-sm animate-pulse"></span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend Footer */}
        <div className="px-4 py-2 border-t border-borderColor bg-bgPrimary/40 flex items-center justify-between text-[11px] text-textMuted">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accentColor"></span>
            <span>有历史记录条目</span>
          </div>
          <span>点击日期跳转</span>
        </div>
      </div>
    </div>
  );
}
