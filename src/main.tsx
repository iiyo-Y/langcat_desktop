/**
 * 渲染层入口 —— 单 bundle 双视图
 *
 * BrowserWindow 加载时通过 URL hash 区分:
 *   #/main      → MainView(主窗口,显示用法 + 最近查询)
 *   #/popover   → PopoverView(无边框浮窗,显示当前查询的卡片)
 *
 * 单 bundle 的好处:popover 启动即时(BrowserWindow 复用,JS 已经预加载)。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MainView } from '@components/MainView';
import { PopoverView } from '@components/PopoverView';
import './styles/global.css';
import './types/bridge'; // 注册 window.langcat 类型扩展

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('[LangCat] 找不到 #root 节点');
}

const route = window.location.hash.replace(/^#/, '') || '/main';
const View = route === '/popover' ? PopoverView : MainView;

// 给 body 标记当前 view,global.css 据此切换背景透明度等基础样式
document.body.classList.add(
  route === '/popover' ? 'langcat-popover' : 'langcat-main',
);

createRoot(rootElement).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
