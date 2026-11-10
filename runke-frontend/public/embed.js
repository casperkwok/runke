/* Runke.ai 网站集成嵌入脚本。
   用法：<script src="https://<host>/embed.js" data-bot="<botId>" data-color="#3B5BFF"></script>
   会在页面右下角注入一个悬浮气泡，点击展开与该已发布 Agent 的对话。 */
(function () {
  var cur = document.currentScript;
  var botId = cur && cur.getAttribute("data-bot");
  if (!botId) { console.error("[Runke widget] missing data-bot"); return; }
  var color = (cur && cur.getAttribute("data-color")) || "#3B5BFF";
  // 从脚本地址推导站点 origin
  var origin = "";
  try { origin = new URL(cur.src).origin; } catch (e) { origin = location.origin; }
  var widgetUrl = origin + "/widget/" + botId;

  var open = false;
  var btn = document.createElement("button");
  btn.setAttribute("aria-label", "在线咨询");
  btn.style.cssText =
    "position:fixed;right:24px;bottom:24px;width:56px;height:56px;border-radius:50%;border:none;" +
    "background:" + color + ";box-shadow:0 6px 20px rgba(20,28,52,.28);cursor:pointer;z-index:2147483000;" +
    "display:flex;align-items:center;justify-content:center;transition:transform .15s;";
  btn.onmouseenter = function () { btn.style.transform = "scale(1.06)"; };
  btn.onmouseleave = function () { btn.style.transform = "none"; };
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z"/></svg>';

  var frame = document.createElement("iframe");
  frame.src = widgetUrl;
  frame.title = "在线咨询";
  frame.style.cssText =
    "position:fixed;right:24px;bottom:92px;width:380px;height:560px;max-height:80vh;max-width:calc(100vw - 32px);" +
    "border:none;border-radius:16px;box-shadow:0 12px 40px rgba(20,28,52,.24);z-index:2147483000;" +
    "display:none;background:#fff;overflow:hidden;";

  function toggle(next) {
    open = next === undefined ? !open : next;
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
      : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z"/></svg>';
  }
  btn.onclick = function () { toggle(); };

  // iframe 内点关闭 → 收起
  window.addEventListener("message", function (e) {
    if (e.data === "rk-widget-close") toggle(false);
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(btn);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
