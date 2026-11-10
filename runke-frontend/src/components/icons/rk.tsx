/* Runke 原型图标移植（源：Runke产品原型/icons.jsx）。线性 24x24 glyph。 */
import type { CSSProperties, ReactNode } from "react";

export interface IcProps {
  s?: number;
  sw?: number;
  style?: CSSProperties;
  className?: string;
}

export const Svg = ({ s = 20, sw = 1.7, children, style, className }: IcProps & { children: ReactNode }) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    className={className}
  >
    {children}
  </svg>
);

/* 品牌标记 — 渐变方块上的双叠圆（外层渐变在调用处用 .bg-grad 包裹） */
export const BrandMark = ({ s = 30 }: { s?: number }) => (
  <svg width={s * 0.62} height={s * 0.62} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="12.5" height="12.5" rx="4.5" fill="#fff" fillOpacity="0.96" />
    <rect x="9" y="9" width="12" height="12" rx="4.8" fill="#fff" fillOpacity="0.6" />
  </svg>
);

/* 侧边栏 */
export const IcWorkbench = (p: IcProps) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></Svg>;
export const IcChat = (p: IcProps) => <Svg {...p}><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z" /></Svg>;
export const IcAssistant = (p: IcProps) => <Svg {...p}><path d="M12 3a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Z" /><path d="M12 14v3" /><path d="M8 21h8" /></Svg>;
export const IcKnowledge = (p: IcProps) => <Svg {...p}><path d="M12 4 4 8l8 4 8-4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /><path d="m4 8 8 4 8-4" /></Svg>;
export const IcMarketing = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></Svg>;
export const IcCustomers = (p: IcProps) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 19.5" /></Svg>;
export const IcOrg = (p: IcProps) => <Svg {...p}><rect x="9" y="3" width="6" height="5" rx="1.4" /><rect x="3" y="16" width="6" height="5" rx="1.4" /><rect x="15" y="16" width="6" height="5" rx="1.4" /><path d="M12 8v4M6 16v-2h12v2" /></Svg>;
export const IcExperience = (p: IcProps) => <Svg {...p}><path d="M12 3a9 9 0 1 0 9 9c0-.7-1-1-1.6-.5-.7.5-1.7.6-2.4-.1-.9-.9-.3-2 .3-2.7.5-.6.2-1.7-.6-2A9 9 0 0 0 12 3Z" /><circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none" /></Svg>;
export const IcSkillNav = (p: IcProps) => <Svg {...p}><path d="M14.5 5.5a3.4 3.4 0 0 0-4.5 4.2l-4.8 4.8a1.6 1.6 0 0 0 2.3 2.3l4.8-4.8a3.4 3.4 0 0 0 4.2-4.5l-2 2-1.8-.3-.3-1.8 2-2Z" /></Svg>;

/* 节点图标 */
export const IcLlm = (p: IcProps) => <Svg {...p}><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" /><path d="m4.5 7 7.5 4 7.5-4M12 11v10" /></Svg>;
export const IcKb = (p: IcProps) => <Svg {...p}><path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" /></Svg>;

/* 工作流节点图标 */
export const IcVar = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m9 9 6 6M15 9l-6 6" /></Svg>;
export const IcReply = (p: IcProps) => <Svg {...p}><circle cx="6" cy="12" r="2.2" /><circle cx="18" cy="7" r="2.2" /><circle cx="18" cy="17" r="2.2" /><path d="M8.1 11l7.8-3.5M8.1 13l7.8 3.5" /></Svg>;
export const IcCond = (p: IcProps) => <Svg {...p}><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M6 8.2v7.6M8.1 6h4.2a3.5 3.5 0 0 1 3.5 3.5v.3M8.1 18h4.2a3.5 3.5 0 0 0 3.5-3.5v-.3" /></Svg>;
export const IcIntent = (p: IcProps) => <Svg {...p}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" /></Svg>;
export const IcHuman = (p: IcProps) => <Svg {...p}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></Svg>;
export const IcApp = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></Svg>;
export const IcStart = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" /></Svg>;
export const IcEnd = (p: IcProps) => <Svg {...p}><path d="M12 4v6" /><path d="M6.5 7a7 7 0 1 0 11 0" /></Svg>;
export const IcZoomIn = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M11 8.5v5M8.5 11h5M20 20l-4.3-4.3" /></Svg>;
export const IcZoomOut = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M8.5 11h5M20 20l-4.3-4.3" /></Svg>;
export const IcHand = (p: IcProps) => <Svg {...p}><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-.5V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.8-1.8L5 14.5s-.8-1 .2-1.8 2 .3 2 .3L8 14" /></Svg>;
export const IcCursor = (p: IcProps) => <Svg {...p}><path d="M5 4l5.5 14 2-5.5 5.5-2L5 4Z" /></Svg>;

/* UI glyphs */
export const IcBack = (p: IcProps) => <Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>;
export const IcPencil = (p: IcProps) => <Svg {...p}><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4 11.5-11.5Z" /></Svg>;
export const IcSend = (p: IcProps) => <Svg {...p}><path d="M5 12 20 5l-5 15-3.5-6.5L5 12Z" /></Svg>;
export const IcMore = (p: IcProps) => <Svg {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></Svg>;
export const IcPlus = (p: IcProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IcClose = (p: IcProps) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>;
export const IcChevDown = (p: IcProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IcChevUp = (p: IcProps) => <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>;
export const IcChevRight = (p: IcProps) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IcCheck = (p: IcProps) => <Svg {...p}><path d="m5 12 5 5 9-11" /></Svg>;
export const IcTrash = (p: IcProps) => <Svg {...p}><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" /></Svg>;
export const IcCopy = (p: IcProps) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2.2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>;
export const IcEditMenu = (p: IcProps) => <Svg {...p}><path d="M14 5.5 17.5 9 9 17.5l-4 1 1-4L14 5.5Z" /></Svg>;
export const IcEmptyBox = (p: IcProps) => <Svg {...p}><path d="M4 9.5 12 5l8 4.5v6L12 20l-8-4.5v-6Z" /><path d="m4 9.5 8 4.5 8-4.5M12 14v6" /></Svg>;
export const IcWeixin = (p: IcProps) => <Svg {...p}><path d="M9 4.5C5.4 4.5 2.5 6.9 2.5 9.9c0 1.7.9 3.2 2.4 4.2l-.5 1.9 2.2-1.1c.7.2 1.5.3 2.4.3h.4a4.7 4.7 0 0 1-.1-1c0-2.9 2.8-5.2 6.3-5.2h.6C15.9 6.4 12.8 4.5 9 4.5Z" fill="currentColor" stroke="none" /><path d="M21.5 14.4c0-2.4-2.4-4.4-5.3-4.4s-5.3 2-5.3 4.4 2.4 4.4 5.3 4.4c.7 0 1.4-.1 2-.3l1.9.95-.45-1.6c1.1-.8 1.85-2 1.85-3.45Z" fill="currentColor" stroke="none" /></Svg>;
export const IcPalette = (p: IcProps) => <Svg {...p}><path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.9 2-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.8-1.6 1.7-1.6H16a5 5 0 0 0 5-5c0-3.9-4-6-9-6Z" /><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" /><circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="8" r="1.1" fill="currentColor" stroke="none" /></Svg>;
export const IcLink = (p: IcProps) => <Svg {...p}><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" /><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" /></Svg>;
export const IcPhone = (p: IcProps) => <Svg {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></Svg>;
export const IcVoiceNode = (p: IcProps) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const MIcInfo = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" /></Svg>;

/* 单 Agent 编辑器局部图标 */
export const SIcHeadset = (p: IcProps) => <Svg {...p}><path d="M5 13v-1a7 7 0 0 1 14 0v1" /><rect x="3" y="13" width="4" height="6" rx="1.6" /><rect x="17" y="13" width="4" height="6" rx="1.6" /><path d="M19 19a4 4 0 0 1-4 3h-2" /></Svg>;
export const SIcRobot = (p: IcProps) => <Svg {...p}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6" /><circle cx="12" cy="4" r="1.3" /></Svg>;
export const SIcFlow = (p: IcProps) => <Svg {...p}><rect x="3.5" y="4" width="6" height="6" rx="1.5" /><rect x="14.5" y="4" width="6" height="6" rx="1.5" /><rect x="9" y="14" width="6" height="6" rx="1.5" /><path d="M6.5 10v2.5h11V10M12 12.5V14" /></Svg>;
export const SIcSpark = (p: IcProps) => <Svg {...p}><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" /><path d="M18 14l.7 1.8L20.5 16.5 18.7 17.2 18 19l-.7-1.8L15.5 16.5 17.3 15.8 18 14Z" /></Svg>;
export const SIcGear = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.5 1.5M16.5 16.5 18 18M6 18l1.5-1.5M16.5 7.5 18 6" /></Svg>;
export const SIcModel = (p: IcProps) => <Svg {...p}><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" /><path d="m4.5 7 7.5 4 7.5-4M12 11v10" /></Svg>;
export const SIcRole = (p: IcProps) => <Svg {...p}><path d="M12 4l1.9 4.6L19 9l-3.7 3.3 1.1 5L12 14.8 7.6 17.3l1.1-5L5 9l5.1-.4L12 4Z" /></Svg>;
export const SIcHi = (p: IcProps) => <Svg {...p}><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z" /><path d="M9 10h6M9 13h3" /></Svg>;
export const SIcBook = (p: IcProps) => <Svg {...p}><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" /><path d="M5 16h13" /></Svg>;
export const SIcImage = (p: IcProps) => <Svg {...p}><rect x="4" y="5" width="16" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4 4 3.5L17 13l3 3" /></Svg>;
export const SIcFolder = (p: IcProps) => <Svg {...p}><path d="M4 7a1 1 0 0 1 1-1h3.5l1.5 1.6H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" /></Svg>;
export const SIcMinus = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12h7" /></Svg>;
export const SIcDrag = (p: IcProps) => <Svg {...p}>{[7, 12, 17].flatMap((cy) => [9, 15].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" fill="currentColor" stroke="none" />))}</Svg>;
export const SkIcTool = (p: IcProps) => <Svg {...p}><path d="M14.5 5.5a3.4 3.4 0 0 0-4.5 4.2l-4.8 4.8a1.6 1.6 0 0 0 2.3 2.3l4.8-4.8a3.4 3.4 0 0 0 4.2-4.5l-2 2-1.8-.3-.3-1.8 2-2Z" /></Svg>;
