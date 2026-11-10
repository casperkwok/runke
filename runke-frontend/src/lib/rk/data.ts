/* Runke mock 数据（移植自 Runke产品原型/*-data.jsx）。所有模块的演示数据集中于此。 */

export const CUST_STATUS = {
  lead: { key: "lead", label: "线索", color: "#2D6FF7", soft: "#E8F0FE" },
  intent: { key: "intent", label: "意向", color: "#1FA85A", soft: "#E5F6EC" },
  deal: { key: "deal", label: "成交", color: "#7C4DF5", soft: "#EFEAFE" },
  lost: { key: "lost", label: "流失", color: "#98A0B3", soft: "#EEF0F4" },
} as const;
export type CustStatus = keyof typeof CUST_STATUS;

export const INTENT_LV: Record<string, { label: string; color: string; soft: string }> = {
  A: { label: "A — 高意向", color: "#1FA85A", soft: "#E5F6EC" },
  B: { label: "B — 中意向", color: "#2D6FF7", soft: "#E8F0FE" },
  C: { label: "C — 低意向", color: "#E8862E", soft: "#FDEEDF" },
  D: { label: "D — 待评估", color: "#98A0B3", soft: "#EEF0F4" },
};

export const FOLLOW_STAGES = ["线索生成", "初步接触", "需求确认", "方案报价", "已成交"];

export const CUST_RESOURCE_PACKS: { id: string; name: string; kind: string; count: number }[] = [];

export interface CustRecord {
  type: "ai" | "human";
  text: string;
  time: string;
}
export interface Customer {
  id: string;
  name: string;
  company?: string;
  title?: string;
  gender?: string;
  email?: string;
  phone: string;
  status: CustStatus;
  intent: string | null;
  agent: string | null;
  agentType: "phone" | "chat" | null;
  stage: string;
  owner: string | null;
  time: string;
  tags?: string[];
  ai?: Record<string, boolean>;
  summary?: string;
  records?: CustRecord[];
}

const raw: Customer[] = [
  { id: "c1", name: "13812340001", phone: "13812340001", status: "lead", intent: null, agent: null, agentType: null, stage: "线索生成", owner: null, time: "2024-07-16 10:00:00" },
  { id: "c2", name: "13812340002", phone: "13812340002", status: "lead", intent: null, agent: null, agentType: null, stage: "线索生成", owner: null, time: "2024-07-16 10:00:00" },
  { id: "c3", name: "13912340003", phone: "13912340003", status: "lead", intent: null, agent: null, agentType: null, stage: "线索生成", owner: null, time: "2024-07-16 10:00:00" },
  { id: "c4", name: "13912340004", phone: "13912340004", status: "lead", intent: null, agent: null, agentType: null, stage: "线索生成", owner: null, time: "2024-07-16 10:00:00" },
];

const named: Customer[] = [
  { id: "c5", name: "陈明远", company: "示例科技有限公司", title: "电商运营总监", gender: "男", email: "chenmingyuan@example.com", phone: "1310000000", status: "intent", intent: "A", agent: "电商活动促销智能体", agentType: "phone", stage: "线索生成", owner: "陈销售", time: "2024-07-15 09:00:00", tags: ["电商", "高意向"], ai: { company: true, title: true, phone: true }, summary: "客户表示公司正在筹备618大促，需要智能客服来应对咨询高峰。询问了并发能力、知识库配置和多轮对话能力。对价格不敏感，希望尽快上线。", records: [{ type: "ai", text: "客户表示公司正在筹备618大促，需要智能客服来应对咨询高峰。询问了并发能力、知识库配置和多轮对话能力。对价格不敏感，希望尽快上线。", time: "2024-07-15 09:00:00" }, { type: "human", text: "已电话沟通，约定本周五线上演示 Demo。", time: "2024-07-15 14:30:00" }] },
  { id: "c6", name: "林小雅", company: "味坊餐饮集团", title: "门店运营经理", gender: "女", email: "linxiaoya@weifang.com", phone: "1510001234", status: "deal", intent: "B", agent: "餐厅预约智能体", agentType: "chat", stage: "已成交", owner: "林运营", time: "2024-07-14 10:07:00", tags: ["餐饮", "已签约"], ai: { title: true }, summary: "连锁餐厅希望用智能体处理订座、排队叫号和会员咨询，已确认采购标准版年付方案。", records: [{ type: "ai", text: "客户咨询餐厅预约与叫号场景，确认接入企业微信，已签约标准版。", time: "2024-07-14 10:07:00" }] },
  { id: "c7", name: "张建国", company: "建国数码", title: "总经理", gender: "男", email: "zjg@jiandigital.com", phone: "1710002468", status: "intent", intent: "C", agent: "满意度回访智能体", agentType: "phone", stage: "需求确认", owner: "王主管", time: "2024-07-13 11:14:00", tags: ["数码"], ai: { company: true }, summary: "客户对售后满意度自动回访感兴趣，正在比较两家供应商，关注回访话术可配置程度。", records: [{ type: "ai", text: "客户希望对成交后客户做自动满意度回访，关注话术自定义能力。", time: "2024-07-13 11:14:00" }] },
  { id: "c8", name: "王丽华", company: "丽华优选", title: "电商负责人", gender: "女", email: "wlh@lihua.com", phone: "1810003702", status: "lead", intent: "D", agent: "电商售后智能体", agentType: "chat", stage: "方案报价", owner: "陈销售", time: "2024-07-12 12:21:00", tags: ["电商"], ai: {}, summary: "咨询电商退换货自动处理能力，已发送报价，等待客户内部评估。", records: [{ type: "ai", text: "客户咨询退换货工单自动流转，已发送方案报价单。", time: "2024-07-12 12:21:00" }] },
  { id: "c9", name: "刘医生", company: "康宁口腔诊所", title: "院长", gender: "男", email: "liu@kangning.com", phone: "1310004936", status: "deal", intent: "A", agent: "房产咨询智能体", agentType: "phone", stage: "已成交", owner: "林运营", time: "2024-07-11 13:28:00", tags: ["医疗", "已签约"], ai: { title: true, company: true }, summary: "口腔诊所需要预约提醒与术后回访自动化，已成交并完成首次上线。", records: [{ type: "ai", text: "诊所希望自动化预约提醒与术后回访，已签约付款。", time: "2024-07-11 13:28:00" }] },
  { id: "c10", name: "赵红梅", company: "红梅教育", title: "课程顾问主管", gender: "女", email: "zhm@hongmeiedu.com", phone: "1510006170", status: "intent", intent: "B", agent: "教育课程推广智能体", agentType: "chat", stage: "线索生成", owner: "王主管", time: "2024-07-10 14:35:00", tags: ["教育"], ai: { company: true }, summary: "教育机构希望智能体在公众号自动解答课程咨询并留资，关注转化率统计。", records: [{ type: "ai", text: "客户咨询课程推广自动留资场景，关注线索转化报表。", time: "2024-07-10 14:35:00" }] },
  { id: "c11", name: "孙律师", company: "正衡律师事务所", title: "合伙人", gender: "男", email: "sun@zhenghenglaw.com", phone: "1710007404", status: "lead", intent: "C", agent: "医疗预约智能体", agentType: "phone", stage: "初步接触", owner: "陈销售", time: "2024-07-09 15:42:00", tags: ["法律"], ai: {}, summary: "律所咨询线索初步接触，希望了解智能体如何对法律咨询做初筛和分流。", records: [{ type: "ai", text: "客户咨询法律咨询初筛分流场景，需进一步沟通需求。", time: "2024-07-09 15:42:00" }] },
];

export const CUSTOMERS: Customer[] = [...raw, ...named];

export const CUST_STATUS_DEFS = [
  { key: "lead", desc: "刚获取或刚接触的客户，可能通过官网注册、活动获客、线索池分配等方式引入，需要销售跟进转化", system: true },
  { key: "intent", desc: "有过明确需求沟通、有购买意向的客户，可以进行方案报价或谈判", system: true },
  { key: "deal", desc: "已签约付款的客户进入此状态，进入客户成功交付流程", system: true },
  { key: "lost", desc: "明确拒绝、长期无响应或无法触达，进入客户池沉淀或关闭", system: true },
];

export const INTENT_DEFS = [
  { key: "A", desc: "需求明确、预算充足、决策链清晰，应优先高频跟进", system: true },
  { key: "B", desc: "有一定需求但仍在比较或评估阶段，需持续培育", system: true },
  { key: "C", desc: "需求模糊或预算有限，保持轻度触达即可", system: true },
  { key: "D", desc: "信息不足，尚无法判断意向，等待进一步沟通", system: true },
];
