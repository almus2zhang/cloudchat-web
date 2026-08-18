import React, { useState, useMemo } from 'react';

export default function CalendarModal({ isOpen, onClose, messages = [], onSelectDate }) {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0 - 11
  const [viewMode, setViewMode] = useState('DAY'); // 'DAY' | 'MONTH' | 'YEAR'

  // Extract maps & sets for dates, months, years with messages (Hooks called unconditionally at top)
  const { datesWithMessagesMap, yearsWithMessages, monthsWithMessages } = useMemo(() => {
    const datesMap = new Map();
    const yearsSet = new Set();
    const monthsSet = new Set(); // format: YYYY-MM
    messages.forEach(msg => {
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        const yyyy = d.getFullYear();
        const mmNum = d.getMonth() + 1;
        const mm = String(mmNum).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const monthStr = `${yyyy}-${mm}`;
        
        datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
        yearsSet.add(yyyy);
        monthsSet.add(monthStr);
      }
    });
    return { datesWithMessagesMap: datesMap, yearsWithMessages: yearsSet, monthsWithMessages: monthsSet };
  }, [messages]);

  // Available Years list (from 2010 or earliest message year up to today+2)
  const earliestMsgYear = useMemo(() => {
    if (yearsWithMessages.size === 0) return 2015;
    return Math.min(2010, Math.min(...Array.from(yearsWithMessages)));
  }, [yearsWithMessages]);

  if (!isOpen) return null;

  // Month navigation helpers
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
    setViewMode('DAY');
  };

  // Calendar matrix calculations
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const availableYears = [];
  const startYear = earliestMsgYear;
  const endYear = Math.max(today.getFullYear() + 2, currentYear + 2);
  for (let y = endYear; y >= startYear; y--) {
    availableYears.push(y);
  }

  // Days grid cells
  const gridCells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    gridCells.push({ key: `pad-${i}`, dayNum: null });
  }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl shadow-2xl w-full max-w-sm max-w-[calc(100vw-16px)] overflow-hidden flex flex-col max-h-[92vh]">
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

        {/* Controls: Year / Month Navigation Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-bgPrimary/30">
          {viewMode === 'DAY' ? (
            <button
              onClick={handlePrevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bgPrimary text-textPrimary transition-all"
              title="上个月"
            >
              <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
          ) : (
            <div className="w-8"></div>
          )}

          <div className="flex items-center gap-1.5">
            {/* Year Button & Selector */}
            <select
              value={currentYear}
              onChange={(e) => {
                setCurrentYear(Number(e.target.value));
                setViewMode('DAY');
              }}
              className="bg-bgPrimary border border-borderColor text-textPrimary text-xs font-semibold rounded-md px-2 py-1 focus:outline-none focus:border-accentColor cursor-pointer"
            >
              {availableYears.map(y => {
                const hasMsgs = yearsWithMessages.has(y);
                return (
                  <option key={y} value={y}>
                    {y}年 {hasMsgs ? '•' : ''}
                  </option>
                );
              })}
            </select>

            {/* Month Button & Selector */}
            <select
              value={currentMonth}
              onChange={(e) => {
                setCurrentMonth(Number(e.target.value));
                setViewMode('DAY');
              }}
              className="bg-bgPrimary border border-borderColor text-textPrimary text-xs font-semibold rounded-md px-2 py-1 focus:outline-none focus:border-accentColor cursor-pointer"
            >
              {monthNames.map((m, idx) => {
                const mStr = `${currentYear}-${String(idx + 1).padStart(2, '0')}`;
                const hasMsgs = monthsWithMessages.has(mStr);
                return (
                  <option key={idx} value={idx}>
                    {m} {hasMsgs ? '•' : ''}
                  </option>
                );
              })}
            </select>

            <button
              onClick={handleToday}
              className="px-2 py-1 text-[11px] font-medium bg-accentColor/10 text-accentColor border border-accentColor/30 rounded-md hover:bg-accentColor/20 transition-all ml-1"
            >
              今
            </button>
          </div>

          {viewMode === 'DAY' ? (
            <button
              onClick={handleNextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bgPrimary text-textPrimary transition-all"
              title="下个月"
            >
              <i className="fa-solid fa-chevron-right text-xs"></i>
            </button>
          ) : (
            <div className="w-8"></div>
          )}
        </div>

        {/* View Mode Switcher Sub-bar */}
        <div className="flex border-b border-borderColor/40 bg-bgPrimary/20 text-xs font-medium">
          <button
            onClick={() => setViewMode('DAY')}
            className={`flex-1 py-1.5 text-center transition-all ${viewMode === 'DAY' ? 'text-accentColor border-b-2 border-accentColor font-bold' : 'text-textMuted hover:text-textPrimary'}`}
          >
            日视图
          </button>
          <button
            onClick={() => setViewMode('MONTH')}
            className={`flex-1 py-1.5 text-center transition-all ${viewMode === 'MONTH' ? 'text-accentColor border-b-2 border-accentColor font-bold' : 'text-textMuted hover:text-textPrimary'}`}
          >
            月视图 {monthsWithMessages.has(`${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`) ? '•' : ''}
          </button>
          <button
            onClick={() => setViewMode('YEAR')}
            className={`flex-1 py-1.5 text-center transition-all ${viewMode === 'YEAR' ? 'text-accentColor border-b-2 border-accentColor font-bold' : 'text-textMuted hover:text-textPrimary'}`}
          >
            年视图 {yearsWithMessages.has(currentYear) ? '•' : ''}
          </button>
        </div>

        {/* Body View Content */}
        {viewMode === 'DAY' && (
          <>
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
            <div className="grid grid-cols-7 gap-1 p-3 flex-1">
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
          </>
        )}

        {viewMode === 'MONTH' && (
          <div className="grid grid-cols-3 gap-2.5 p-4 flex-1 items-center">
            {monthNames.map((name, idx) => {
              const mStr = `${currentYear}-${String(idx + 1).padStart(2, '0')}`;
              const hasMsgs = monthsWithMessages.has(mStr);
              const isCurrent = idx === currentMonth;

              return (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentMonth(idx);
                    setViewMode('DAY');
                  }}
                  className={`py-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
                    isCurrent
                      ? 'border-accentColor bg-accentColor/15 text-accentColor font-bold'
                      : 'border-borderColor bg-bgPrimary/40 hover:bg-bgPrimary text-textPrimary'
                  }`}
                >
                  <span className="text-xs">{name}</span>
                  {hasMsgs && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accentColor mt-1"></span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {viewMode === 'YEAR' && (
          <div className="grid grid-cols-3 gap-2.5 p-4 max-h-[260px] overflow-y-auto flex-1 custom-scrollbar">
            {availableYears.map((y) => {
              const hasMsgs = yearsWithMessages.has(y);
              const isCurrent = y === currentYear;

              return (
                <button
                  key={y}
                  onClick={() => {
                    setCurrentYear(y);
                    setViewMode('DAY');
                  }}
                  className={`py-2.5 rounded-xl border flex flex-col items-center justify-center transition-all ${
                    isCurrent
                      ? 'border-accentColor bg-accentColor/15 text-accentColor font-bold'
                      : 'border-borderColor bg-bgPrimary/40 hover:bg-bgPrimary text-textPrimary'
                  }`}
                >
                  <span className="text-xs font-mono">{y}年</span>
                  {hasMsgs && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accentColor mt-1"></span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend Footer */}
        <div className="px-4 py-2 border-t border-borderColor bg-bgPrimary/40 flex items-center justify-between text-[11px] text-textMuted">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accentColor"></span>
            <span>有历史条目 (含 • 标注)</span>
          </div>
          <span>点击快速选择</span>
        </div>
      </div>
    </div>
  );
}
