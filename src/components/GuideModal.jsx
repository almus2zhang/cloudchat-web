import React from 'react';

export default function GuideModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bgSecondary border border-borderColor rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="h-14 border-b border-borderColor px-6 flex items-center justify-between bg-bgPrimary/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accentColor/10 text-accentColor flex items-center justify-center font-bold text-sm">
              <i className="fa-solid fa-book-open"></i>
            </div>
            <div>
              <h2 className="font-bold text-textPrimary text-sm">CloudChat 使用说明与图标指南</h2>
              <p className="text-[11px] text-textMuted">多选工具栏图标功能解析与全平台快捷操作说明</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-textSecondary hover:text-textPrimary hover:bg-white/5 transition-all flex items-center justify-center"
          >
            <i className="fa-solid fa-xmark text-base"></i>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-textSecondary">
          
          {/* Section 1: Toolbar Icons */}
          <div>
            <h3 className="text-xs font-bold text-accentColor uppercase tracking-wider mb-3 flex items-center gap-2">
              <i className="fa-solid fa-toolbox"></i> 批量操作与多选工具栏图标解析
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              
              {/* 打包 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-folder-plus"></i> 打包
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">归档打包文件夹</p>
                  <p className="text-[11px] text-textMuted mt-0.5">将选中的多条消息（文字、图片、文件）收纳归档为一个文件夹消息卡片。</p>
                </div>
              </div>

              {/* 移入 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-folder-arrow-right"></i> 移入
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">移入已有文件夹</p>
                  <p className="text-[11px] text-textMuted mt-0.5">将选中的消息或记录移入已存在的指定文件夹中。</p>
                </div>
              </div>

              {/* 合并 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-object-group"></i> 合并
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">拼接长卡片合并</p>
                  <p className="text-[11px] text-textMuted mt-0.5">将多条散落的文本或图片消息有序合并为一条完整的长卡片。</p>
                </div>
              </div>

              {/* 拆散 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-object-ungroup"></i> 拆散
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">解散文件夹 / 拆分消息</p>
                  <p className="text-[11px] text-textMuted mt-0.5">将已打包的文件夹或合并的消息卡片解散还原为多条独立的记录。</p>
                </div>
              </div>

              {/* 日记 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-book-bookmark"></i> 日记
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">生成 HTML 静态网页日记</p>
                  <p className="text-[11px] text-textMuted mt-0.5">提取选中的聊天素材，一键生成精致排版的 HTML 静态日记页面。</p>
                </div>
              </div>

              {/* 下载 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-teal-500/10 text-teal-400 border border-teal-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-download"></i> 下载
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">批量保存多媒体资源</p>
                  <p className="text-[11px] text-textMuted mt-0.5">批量下载选中的所有图片、视频、语音与文件素材到本地磁盘。</p>
                </div>
              </div>

              {/* 范围 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-[#00d2ff]"></i> ✓ 范围
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">智能区间连续框选</p>
                  <p className="text-[11px] text-textMuted mt-0.5">选中起始消息后，点击“范围”并点击终点消息，智能一次性选中整个区间。</p>
                </div>
              </div>

              {/* 隐私/隐藏 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-eye-slash"></i> 隐私
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">移入暗号隐藏空间</p>
                  <p className="text-[11px] text-textMuted mt-0.5">隐藏选中的敏感内容，需在输入框键入 PIN 码暗号（如 ##1234##）解锁查看。</p>
                </div>
              </div>

              {/* 删除 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-trash-can"></i> 删除
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">彻底删除记录</p>
                  <p className="text-[11px] text-textMuted mt-0.5">将选中的记录移入回收站并同步清理本地存储。</p>
                </div>
              </div>

              {/* 取消 */}
              <div className="p-3 bg-bgPrimary/40 border border-borderColor/60 rounded-xl flex items-start gap-3">
                <div className="px-2.5 py-1.5 bg-gray-500/10 text-gray-400 border border-gray-500/30 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5">
                  <i className="fa-solid fa-xmark"></i> 取消
                </div>
                <div>
                  <p className="font-semibold text-textPrimary">退出多选操作</p>
                  <p className="text-[11px] text-textMuted mt-0.5">清空当前所有选中项，关闭多选工具栏。</p>
                </div>
              </div>

            </div>
          </div>

          {/* Section 2: Android Quick Send Feature */}
          <div className="border-t border-borderColor/40 pt-4">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <i className="fa-solid fa-[#ffb703]"></i> 📸 Android 手机专属：截图快捷悬浮发送
            </h3>
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <p className="text-textPrimary font-semibold mb-1">无需打开相册，智能识别最新截图</p>
              <p className="text-[11px] text-textMuted leading-relaxed">
                在手机上完成系统截屏或拍摄照片后，进入 CloudChat 聊天界面并点击输入框右侧的加号 <span className="px-1.5 py-0.5 bg-bgSecondary border border-borderColor rounded text-accentColor font-bold">+</span>，
                输入框上方会自动弹出现刚才截屏缩略图浮窗，点击“一键发送”即可瞬间发送该截图！
              </p>
            </div>
          </div>

          {/* Section 3: Smart Sync Feature */}
          <div className="border-t border-borderColor/40 pt-4">
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <i className="fa-solid fa-shield-halved"></i> ⚡ WebDAV 物理修改时间增量同步
            </h3>
            <p className="text-[11px] text-textMuted leading-relaxed">
              全平台采用权威的 WebDAV RFC 4918 <code className="text-accentColor">PROPFIND XML</code> 物理文件修改时间比对技术。只要云端没有产生新聊天消息，客户端即自动判定为 <span className="text-emerald-400 font-semibold">[Sync] 云端索引无变化</span> 避免流量损耗。
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="h-14 border-t border-borderColor px-6 flex items-center justify-end bg-bgPrimary/20">
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-accentColor text-white font-medium text-xs rounded-xl hover:bg-accentColor/90 transition-all shadow-md"
          >
            我明白了
          </button>
        </div>

      </div>
    </div>
  );
}
