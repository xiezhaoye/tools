// ==UserScript==
// @name         微博宽屏版（logo位置菜单icon + 悬浮菜单 + 自适应内容）
// @namespace    https://github.com/xiezhaoye/tools
// @version      3.2.3
// @description  去掉 logo 改为菜单 icon（默认橙）；悬浮菜单只显示自身长度；隐藏右上角"视频/消息"；内容区纯 CSS 弹性自适应、左右对称留白 35px，窗口缩放实时跟手；菜单内点选项/点页面任意处自动收回
// @author       Thomas Damai（原作） / xiezhaoye（3.x 重写）
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @license      MIT
// @run-at       document-start
// @homepageURL  https://github.com/xiezhaoye/tools/tree/main/userscripts/weibo-wide
// @downloadURL  https://raw.githubusercontent.com/xiezhaoye/tools/main/userscripts/weibo-wide/weibo-wide-collapsible.user.js
// @updateURL    https://raw.githubusercontent.com/xiezhaoye/tools/main/userscripts/weibo-wide/weibo-wide-collapsible.user.js
// ==/UserScript==

// 3.x 相对 2.x 改了什么，以及为什么
// ------------------------------------------------------------------
// 2.x 的宽度是 JS 每次 resize 现算成固定 px，再写进 feed 和它的一串祖先。
// 外层容器却是纯 CSS 自适应的，两套机制只要有一次没对上（200ms 防抖、SPA 切
// 路由时 feed 还没挂上就 return、虚拟滚动换掉 DOM 让"还原上次拉伸"的元素引用
// 全部失效、滚动条出现/消失不触发 resize），内外层宽度就错开。
//
// 更要命的是 2.x 把 `_wrap_ecgcn_2` / `_normal_ecgcn_34` 当成"热门页主容器"
// 写进了全局规则，可它们在首页命中的是**每一条微博卡片**。那条规则给卡片加了
// `flex:0 0 auto`（不许收缩）+ `max-width:none`（去掉微博自己的宽度上限），
// 于是每张卡片按自己内容的自然宽度撑开。实测视口 819px 时同屏卡片宽度是
// 358/507/559/1742/2027/2153，页面横向滚动到 2195px —— 这就是"有些宽有些窄"。
//
// 3.x 把宽度完全交回 CSS，JS 只剩菜单交互：
//   · feed 用 flex:1 1 auto 吃掉右栏之外的剩余宽度，浏览器实时算，没有防抖、
//     没有失步、SPA 切页也不会漏更新；
//   · 卡片选择器限定在热门页（html.weibo-wide-hot），绝不在首页全局生效；
//   · 外层 content 和布局行之间那个**没有 class 的 <div>** 用 :has() 按结构
//     命中放开 —— 它是卡住整个宽度的真正瓶颈（见 3b 段注释）；
//   · 右栏放不下时由媒体查询收起，不再靠 JS 里那个会自己失效的宽度判断。
//
// 实测（视口 1379，首页）：微博原生主列 642，2.6.3 反而只有 615，3.2.0 是 1011。

(function () {
    'use strict';

    // ============ 可调配置 ============
    // 外层内容区 / 中间 feed 支持多候选选择器（首页 / tv / hot 类名不同）
    const CONTENT_SELECTORS = ['._content_1ubn9_18'];
    // 首页 feed 主列。
    const FEED_SELECTORS    = ['._full_1l406_7'];
    // hot 页(/hot/weibo/102803)主内容容器。
    // 注意：`_wrap_ecgcn_2` / `_normal_ecgcn_34` 是 woo-panel 组件的哈希类名，
    // 在**首页它们命中的是每一条微博卡片**（article.woo-panel-main），实测一屏
    // 6 张卡片全中。2.x 把它们和首页 feed 写在同一条全局规则里，等于给每张卡片
    // 都加了 `flex:0 0 auto`（不许收缩）+ `max-width:none`（去掉宽度上限），
    // 于是每张卡片按自己内容的自然宽度撑开 —— 实测视口 819px 时卡片宽度是
    // 358/507/559/1742/2027/2153，页面横向滚动到 2195px。这就是"有些宽有些窄"。
    // 所以这两个选择器**必须限定在 hot 页**，绝不能全局生效。
    const HOT_FEED_SELECTORS = ['._wrap_ecgcn_2', '._normal_ecgcn_34'];
    const HOT_PATH_RE = /^\/hot(\/|$)/;
    // 外层 content 与 feed 主列之间的布局行（首页/热门页共用同一个布局模块）。
    const LAYOUT_ROW_SELECTOR = '._wrap_1l406_3';
    const LEFT_SELECTOR     = '._side_1ubn9_37';   // 左侧菜单栏
    const RIGHT_SELECTOR    = '._side_1l406_17';   // 右侧热搜

    // 左上角 logo（会被隐藏，菜单按钮占据其位置）
    const LOGO_SELECTOR = '[class*="logo"]';

    // 需要隐藏的右上角按钮（文字/aria-label/title 或链接，仅限视口顶部区域）
    const NAV_HIDE_TEXT = ['视频', '消息'];
    const NAV_HIDE_HREF = ['/tv', '/video', '/message', '/msg', '/msgbox', '/messagebox'];

    // 需要和 feed 同宽的额外容器（逗号分隔）
    const EXTRA_WIDE_SELECTOR = '';

    const NAV_H      = 56;    // 顶部导航栏高度（悬浮菜单起点）
    const LEFT_W     = 182;   // 左侧菜单展开宽度
    const RIGHT_W    = 282;   // 右侧固定宽度
    const GAP        = 16;    // 列间距
    const FEED_MIN   = 320;   // 中间内容区最小宽度
    const CONTENT_MAX = 1600; // 外层内容区最大宽度
    const SIDE_PAD   = 35;    // 内容区左右留白（左右各 35px）
    const MENU_BG    = '#fff'; // 悬浮菜单背景（深色模式改 #1e1e1e）
    const ORANGE     = '#ff8200'; // 微博橙
    const ICON_SIZE  = 24;    // 菜单 icon 尺寸
    // 窗口窄到这个宽度以下就收起右侧热搜，把宽度全给 feed。
    // 阈值 = feed 最小宽 + 列间距 + 右栏宽 + 左右留白，低于它右栏必然溢出。
    // 想一直保留右栏就把它改成 0。
    const RIGHT_HIDE_BELOW = FEED_MIN + GAP + RIGHT_W + SIDE_PAD * 2;
    // ================================

    const css = `
        /* 1) 外层内容区：随视口自适应，左右对称留白 SIDE_PAD。
              用 calc(100% - ...) 而不是 100vw —— 100vw 把滚动条宽度也算进去，
              会让实际留白比设定值少约 15px，而且滚动条出现/消失时不会触发
              resize，JS 版在这里永远慢一拍。百分比是浏览器自己实时算的。 */
        ${CONTENT_SELECTORS.join(', ')} {
            box-sizing: border-box !important;
            max-width: min(${CONTENT_MAX}px, calc(100% - ${SIDE_PAD * 2}px)) !important;
            width: 100% !important;
            margin: 0 auto !important;
        }

        /* 2) 左侧菜单栏：默认宽度 0；展开时固定定位悬浮层（高度只随内容） */
        ${LEFT_SELECTOR} {
            width: 0 !important;
            min-width: 0 !important;
            overflow: hidden !important;
            opacity: 0;
            visibility: hidden;
            transition: opacity .2s ease;
        }
        body.weibo-wide-open ${LEFT_SELECTOR} {
            position: fixed !important;
            top: ${NAV_H}px !important;
            left: 0 !important;
            width: ${LEFT_W}px !important;
            min-width: ${LEFT_W}px !important;
            height: auto !important;
            max-height: calc(100vh - ${NAV_H}px) !important;
            overflow-y: auto !important;
            opacity: 1;
            visibility: visible;
            z-index: 99999;
            background: ${MENU_BG};
            box-shadow: 2px 0 14px rgba(0,0,0,.18);
        }
        /* 菜单内部子容器若自带铺满高度，一并重置为自然高度 */
        body.weibo-wide-open ${LEFT_SELECTOR} > * {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
        }

        /* 3) 中间 feed：宽度完全交给浏览器，不再有任何 JS 固定 px。
              - 它是 flex item 时：flex:1 1 auto 吃掉右栏之外的全部剩余宽度
              - 它不是 flex item 时：块级元素 width:auto 本来就填满父容器
              关键是 flex-grow 必须为 1。2.x 写的是 flex:0 0 auto（不许放大），
              没被 JS 喂到宽度的元素就只能缩到内容宽度 —— 那就是"窄"的来源。 */
        ${FEED_SELECTORS.join(', ')},
        ${HOT_FEED_SELECTORS.map(sel => `html.weibo-wide-hot ${sel}`).join(',\n        ')} {
            width: auto !important;
            min-width: ${FEED_MIN}px !important;
            max-width: none !important;
            flex: 1 1 auto !important;
        }
        ${EXTRA_WIDE_SELECTOR ? `${EXTRA_WIDE_SELECTOR} {
            width: auto !important;
            max-width: none !important;
            flex: 1 1 auto !important;
        }` : ''}

        /* 3b) 外层 content 和布局行之间夹着一个**没有任何 class 的 <div>**，它是
              flex item 却是 flex:0 1 auto，所以不会跟着 content 长大。实测热门页
              视口 1379 时：content 1309 → 这个无名 div 卡在 620 → 布局行 620 →
              feed 主列只剩 330。没有 class 就只能靠结构命中，:has() 正好干这个。
              加上之后实测主列 330 → 829，6 张卡片全部齐平、无横向溢出。 */
        ${CONTENT_SELECTORS.map(sel => `${sel} > *:has(${LAYOUT_ROW_SELECTOR})`).join(',\n        ')},
        ${LAYOUT_ROW_SELECTOR} {
            width: auto !important;
            min-width: 0 !important;
            max-width: none !important;
            flex: 1 1 auto !important;
        }

        /* 4) 右侧热搜：固定宽度，不参与伸缩 */
        ${RIGHT_SELECTOR} {
            width: ${RIGHT_W}px !important;
            flex: 0 0 ${RIGHT_W}px !important;
        }
        ${RIGHT_HIDE_BELOW ? `
        /* 放不下就收起右栏。2.x 在 JS 里用 offsetWidth < baseW*0.5 判断该不该
           给右栏留位置，窗口宽度 ≤634px 时这个条件自己失效，于是 feed 按"没有
           右栏"算宽度、右栏却还占着 282px，直接溢出。改成媒体查询后由 CSS 兜底。 */
        @media (max-width: ${RIGHT_HIDE_BELOW}px) {
            ${RIGHT_SELECTOR} { display: none !important; }
        }` : ''}

        /* 4b) 实测当前微博的“点图展开”不是 dialog，而是卡片内的
               ._showPictureViewer_*。其中 ._imgWrap_* 被微博固定为 540px：
               当前 627px 视口中它的右边界为 683.8px，令 document 的
               scrollWidth 同样变成 684px，因而出现横向滚动。
               将这个包装层改为父列的 100%，而不是限制原图本身；轮播图、旋转
               及“查看大图”仍可正常工作，且页面宽度回到视口宽度。 */
        [class*="_showPictureViewer_"] [class*="_imgWrap_"] {
            box-sizing: border-box !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
        }
        [class*="_showPictureViewer_"] [class*="_imgWrap_"] > div,
        [class*="_showPictureViewer_"] [class*="_imgWrap_"] img {
            box-sizing: border-box !important;
            max-width: 100% !important;
            height: auto !important;
        }

        /* 5) 菜单 icon 按钮：默认橙色 */
        .weibo-wide-toggle {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            margin: 0 4px;
            padding: 0;
            background: transparent !important;
            border: none;
            cursor: pointer;
            vertical-align: middle;
            color: ${ORANGE};
            transition: color .2s;
        }
        .weibo-wide-toggle svg {
            width: ${ICON_SIZE}px;
            height: ${ICON_SIZE}px;
            fill: currentColor;
            display: block;
        }
        .weibo-wide-toggle:hover { color: ${ORANGE}; }

        /* 兜底：logo 找不到时按钮固定到左上角 */
        .weibo-wide-toggle-fallback {
            position: fixed !important;
            left: 6px;
            top: ${NAV_H - 14}px;
            z-index: 9999999;
        }
    `;

    // ---------- 注入样式 ----------
    // @run-at document-start 时 document.head 还不存在，挂到 documentElement 上，
    // 这样宽屏样式在首帧就生效，不会先闪一下微博原始的窄栏布局。
    function injectStyle() {
        if (document.getElementById('weibo-wide-style')) return;
        const style = document.createElement('style');
        style.id = 'weibo-wide-style';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }
    // hot 页专属的宽屏规则靠 <html> 上这个类开关。微博是 SPA，路由切换不会重新
    // 执行脚本，所以每轮扫描都要重新跟一次当前路径。
    function syncHotFlag() {
        document.documentElement.classList.toggle('weibo-wide-hot', HOT_PATH_RE.test(location.pathname));
    }

    injectStyle();
    syncHotFlag();

    // ---------- 菜单 icon 按钮 ----------
    let toggleBtn = null;
    const MENU_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>';
    function ensureButton() {
        if (toggleBtn && document.body.contains(toggleBtn)) return;
        if (!document.body) return;
        toggleBtn = document.createElement('button');
        toggleBtn.className = 'weibo-wide-toggle';
        toggleBtn.title = '菜单';
        toggleBtn.setAttribute('aria-label', '菜单');
        toggleBtn.innerHTML = MENU_ICON;
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.body.classList.toggle('weibo-wide-open');
            adjustMenuHeight();
        });
        document.body.appendChild(toggleBtn);
    }

    // 去掉 logo，把按钮放到 logo 的位置
    function mountButtonAtLogo() {
        if (!toggleBtn) ensureButton();
        if (!toggleBtn) return;
        if (toggleBtn.dataset.mounted === 'logo') return;

        const logo = document.querySelector(LOGO_SELECTOR);
        if (!logo || !logo.parentElement) return;

        logo.style.display = 'none';
        logo.parentElement.insertBefore(toggleBtn, logo);
        toggleBtn.dataset.mounted = 'logo';
        toggleBtn.classList.remove('weibo-wide-toggle-fallback');
    }

    // ---------- 隐藏右上角"视频/消息"按钮 ----------
    // 每个元素只查一次（__wbChecked）。2.x 每次 DOM 变动都对全文档所有
    // a/button 重新调 getBoundingClientRect，每次都强制同步重排 —— 微博是
    // 无限滚动，DOM 变动极频繁，缩放时的卡顿有相当一部分来自这里。
    function hideNavItems() {
        if (!document.body) return;
        const candidates = document.querySelectorAll('a, button, [role="menuitem"], [role="button"], [class*="nav"] a');
        candidates.forEach((el) => {
            if (el.__wbChecked) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return; // 还没渲染，下轮再看
            el.__wbChecked = true;
            if (rect.top < -10 || rect.top > 150) return;

            const href  = ((el.getAttribute && el.getAttribute('href')) || '').toLowerCase();
            const text  = (el.textContent || '').trim();
            const aria  = ((el.getAttribute && el.getAttribute('aria-label')) || '').trim();
            const title = ((el.getAttribute && el.getAttribute('title')) || '').trim();
            const label = (text || aria || title).toLowerCase();

            const isVideo = (label.includes('视频') && NAV_HIDE_TEXT.includes('视频')) ||
                            NAV_HIDE_HREF.some(h => (h === '/tv' || h === '/video') && href.includes(h));
            const isMsg   = (label.includes('消息') && NAV_HIDE_TEXT.includes('消息')) ||
                            NAV_HIDE_HREF.some(h => (h === '/message' || h === '/msg' || h === '/msgbox' || h === '/messagebox') && href.includes(h));
            if (isVideo || isMsg) {
                el.style.display = 'none';
                const parent = el.parentElement;
                if (parent && parent.children.length === 1 &&
                    (parent.tagName === 'LI' || /item/i.test(parent.className || ''))) {
                    parent.style.display = 'none';
                }
            }
        });
    }

    // ---------- 悬浮菜单高度：只包住内容本身 ----------
    function adjustMenuHeight() {
        const menu = document.querySelector(LEFT_SELECTOR);
        if (!menu) return;
        if (!document.body.classList.contains('weibo-wide-open')) {
            menu.style.height = '';
            return;
        }
        setTimeout(() => {
            if (!document.body.classList.contains('weibo-wide-open')) return;
            const h = menu.scrollHeight;
            const maxH = window.innerHeight - NAV_H;
            menu.style.height = Math.min(h, maxH) + 'px';
        }, 260);
    }

    // ---------- 收拢菜单 ----------
    function closeMenu() {
        document.body.classList.remove('weibo-wide-open');
        adjustMenuHeight();
    }

    // ---------- 菜单交互 ----------
    // 点击页面任意位置收回；点击菜单内任意选项（链接/按钮）也收回；菜单空白处不收回
    function bindOutsideClick() {
        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('weibo-wide-open')) return;

            // 点击菜单内部
            const menu = document.querySelector(LEFT_SELECTOR);
            if (menu && menu.contains(e.target)) {
                if (e.target.closest && e.target.closest('a, button, [role="menuitem"]')) {
                    closeMenu(); // 点了菜单里的选项 → 收回
                }
                return;
            }
            // 点击菜单按钮本身由按钮事件处理（toggle）
            if (toggleBtn && toggleBtn.contains(e.target)) return;

            // 点击页面其他地方 → 收回
            closeMenu();
        }, true);
    }

    // ---------- 监听：窗口缩放 + SPA 路由切换 ----------
    // 内容宽度已经全部由 CSS 负责，这里不再需要重算任何宽度 ——
    // 只有悬浮菜单的高度上限跟 innerHeight 有关，才需要监听 resize。
    window.addEventListener('resize', adjustMenuHeight);

    let scanTimer = null;
    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            syncHotFlag();
            ensureButton();
            mountButtonAtLogo();
            hideNavItems();
        }, 200);
    }

    const observer = new MutationObserver(scheduleScan);
    function startObserver() {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ---------- 初始化 ----------
    function init() {
        injectStyle();
        syncHotFlag();
        ensureButton();
        mountButtonAtLogo();
        hideNavItems();
        adjustMenuHeight();
        bindOutsideClick();
        startObserver();
    }
    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
