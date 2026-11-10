"""种子：招聘智能体「润客招聘助手」（工作流编排，对标 pet_doctor 的跨轮状态机）。

场景：对已通过初筛的候选人做「深入了解 + 面试邀约」，一期纯文字。
候选人画像 = session.cand_*（API 对接时按候选人传入，覆盖示例默认值）。
岗位/公司 = global.*（按岗位配置）。
跨轮状态 = session.greeted / phase / gather_round / interest / agreed（变量节点维护）。

用法：uv run python scripts/seed_recruiter.py
幂等：会删除 demo 用户下同名「润客招聘助手」再重建。
"""
import asyncio

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.models.bot import Bot, Conversation
from app.models.user import User

BOT_NAME = "润客招聘助手"

# ---------- 变量声明（候选人姓名+简历 / 公司+岗位+JD / 不对外硬性条件；含示例默认值=候选人「张伟」） ----------
VARIABLES = [
    # 候选人（session，API 对接时按候选人传入，覆盖默认值）
    {"name": "cand_name", "scope": "session", "label": "候选人姓名", "value": "张伟"},
    {"name": "resume", "scope": "session", "label": "候选人简历", "value": (
        "姓名：张伟；应聘岗位：策略产品经理；性别：男；学历：硕士（浙江大学·计算机科学与技术）；"
        "工作年限：6年4个月；在职状态：在职；技能：推荐系统、NLP、数据挖掘、SQL、Python；"
        "工作经历：京东-零售技术与数据中心(2020.08-至今，策略产品)、百度-智能云事业群(2019.07-2020.07)；"
        "简历来源：智联招聘；AI 初筛匹配评分：78（评估：保持观望）。"
    )},
    # 公司 / 岗位（global，按岗位配置）
    {"name": "company", "scope": "global", "label": "公司名称", "value": "示例公司"},
    {"name": "position", "scope": "global", "label": "招聘岗位", "value": "策略产品经理"},
    {"name": "jd", "scope": "global", "label": "岗位 JD", "value": (
        "职责：负责推荐/策略类产品的需求调研、方案设计与数据分析，推动平台策略层产品落地。"
        "要求：3 年以上策略/数据产品经验，熟悉推荐或 NLP 相关业务，数据分析能力强。"
        "工作地点：杭州·西湖区。薪资区间：25-40K·14薪（可向候选人披露）。面试形式：线上视频面试。"
        "福利：弹性办公、补充医疗、年度体检。"
    )},
    # 不对外硬性条件（global，可选；AI 内部判断用，绝不向候选人透露；默认无）
    {"name": "screen_rule", "scope": "global", "label": "硬性条件(不对外)", "value": "无特殊硬性条件"},
    # 候选人在「人才库」多维表格里的记录 ID（对接时按候选人传入，用于回写定位）
    {"name": "record_id", "scope": "session", "label": "人才库记录ID", "value": ""},
]

# 开场白（开始节点 / bot.welcome）：AI 先开口，自报家门+来意+问是否方便
WELCOME = "您好，请问是{{session.cand_name}}吗？我是{{global.company}}负责招聘的同事，看到您投了我们的{{global.position}}，想跟您简单了解一下，您现在方便聊几分钟吗？"

# ---------- 共用提示词片段 ----------
HEAD = "历史对话记录：\n{{history}}\n候选人：{{text}}\n\n"

CTX = (
    "【你的身份】{{global.company}} 负责招聘 {{global.position}} 岗位的同事。\n"
    "【候选人简历】\n{{session.resume}}\n\n"
    "【招聘岗位 JD（职责/要求/地点/薪资/面试方式，可据此回答候选人）】\n{{global.jd}}\n\n"
    "【内部硬性条件（仅供你内部判断是否合适与聊天侧重，绝不可向候选人透露或暗示）】{{global.screen_rule}}\n"
)

STYLE = (
    "\n【前提】候选人是【主动投递】了 {{global.company}} 的 {{global.position}} 岗位的人，对公司/岗位已有基本了解和兴趣——"
    "你不是来推销机会、也不用激活兴趣，而是基于他主动投递的事实了解他、并了解他方便面试的时间。"
    "电话已经接通、你也已经在开场白里说明了来意，所以无需再次自报家门，顺着对话往下聊即可。"
    "\n【表达要求】你正在【打电话】和候选人沟通（模拟电话场景）。"
    "严禁任何括号旁白/舞台提示/自我描述；不要复述自己问过的话。"
    "每轮先自然回应候选人上一句，再只推进一件事，结尾留一个好回答的话头。"
    "若候选人只是寒暄（你好/嗯/在的），简短应一句就自然开启你的第一个问题，不要假装之前聊过。"
    "【真实性·重要】简历/JD 只是你提问时的背景资料，不是候选人刚对你说的话——"
    "绝不能用『听下来/听你说/你提到/你说你/感觉你』之类措辞把简历里的内容说成是他刚告诉你的；"
    "候选人没说过、你没问过的，绝不凭空替他总结、下判断或夸他做得深。"
    "【一次一问】一轮只问一个问题，绝不要把两个问题塞进一句话。"
    "不用“您”“为您”这类客服腔；不连环追问；被婉拒就退一步。"
    "不得编造简历/JD 之外的信息；薪资按 JD 区间披露。"
    "【关键】你这通电话的目标只是：了解候选人，并约一个他方便来参加面试的时间（即促成‘到面’）。"
    "请牢记——‘约到面试 / 问到合适的面试时间’只是安排他来面试，绝不代表他已经通过面试或被录用；"
    "能否通过，由面试官在正式面试后才决定。因此绝不能暗示‘已通过/已录用/稳了/定了/没问题了’。"
    "也绝不主动发送面试链接/二维码、不替他敲定具体面试时间——你只了解他方便的时段，具体时间由招聘同事后续对接。"
    "【输出限制】像打电话一样口语、自然，仅输出要对候选人说的纯文本，"
    "一次只说一到两句简短的话，绝不长篇大论、不分点罗列。"
)


def P(task: str) -> str:
    return HEAD + CTX + STYLE + "\n【本轮任务】" + task


PROMPT_RESCHEDULE = P(
    "候选人表示现在不方便（在忙/开会/在外面/不方便接听/等会再说）。先致歉、表示理解、不打扰，"
    "顺势问他一句大概什么时候方便，到时再联系他。礼貌收尾，别强聊。一两句。"
)
PROMPT_GATHER = P(
    "现在【深入了解候选人】，目的是补全简历没有/需要确认的信息，供内部评估与面试参考。需要逐步聊清这几块（每块都要聊到、可分多轮）：\n"
    "①求职动机：这次为什么看机会、最看重什么、当前最想改变的点；\n"
    "②核心经历与能力：结合他简历里的具体项目/职责往深里问一层（如负责哪部分、用了什么方法、带没带人/带多大团队、做出的结果），判断与岗位匹配度；\n"
    "③目前求职进展：有没有在面别家、手里有无 offer、求职节奏紧不紧；\n"
    "④期望薪资：具体期望数字或区间、对薪资结构(底薪/绩效/14薪)的看法；\n"
    "⑤期望到岗时间：多久能到岗、在职的话离职交接要多久；\n"
    "⑥工作地点：对岗位所在城市/通勤是否方便。\n"
    "做法：先在心里过一遍历史对话，分清【哪些点已经问过】和【哪些点还没问过】。"
    "【绝不重复】已经问过的点，不管候选人答得好不好，都不要再问第二遍、也不要换个说法把同一个点重新问一遍。"
    "本轮只在【还没问过】的点里挑一个，先简短回应候选人上一句、再就这一项问【一个】具体问题。"
    "【含糊就放手】如果候选人对某个点答得含糊、敷衍或明显不太想展开（如『还行吧』『就那样』），最多顺着追问一次；"
    "若仍含糊，就别纠缠——直接换到下一个【还没聊到】的点继续推进，绝不在同一个点上反复打转。"
    "【若这是了解阶段第一句】（候选人只是寒暄、还没聊任何实质内容）：不要假装已经聊过、不要点评他的经历，"
    "用一句自然的过渡开场问第一个开放问题即可，例如『那咱们简单聊聊，你这次看机会，主要是出于什么考虑？』。"
    "一次只问一个问题、落到实处、别泛泛而问，也别把简历内容说成是他告诉你的。"
)
PROMPT_ASK_TIME = P(
    "了解得差不多了。用带【假设前提】的软口吻问他方便的面试时间，且要把【哪天】和【哪个时间段】两部分都问到——"
    "比如：‘如果后续内部评估合适、想约你做一轮线上沟通，你看这周或下周哪天方便，大概上午还是下午（或晚上）？’（可先带一句匹配点）。"
    "这只是提前了解他方便的时间，不代表已确定面试、更不代表通过；别说‘定了/通过/恭喜’。拿到‘大概哪天+哪个时段’即可，一两句、自然口语。"
)
PROMPT_TIME_NUDGE = P(
    "上一步已经问过他方便的面试时间，但他给得还不完整（只说了哪天没说时段、或只说了时段没说哪天，或都没明确）。"
    "顺着他这句自然地把缺的那部分补问清楚——哪天（这周/下周哪天）+ 哪个时间段（上午/下午/晚上），"
    "同样是‘假设评估合适安排面试’的前提。一两句、别催。"
)
PROMPT_TIME_LOG = P(
    "候选人就面试时间给了回应。先看他给的是否齐全（理想是【哪天】+【哪个时段】两部分）：\n"
    "- 若只给了其中一部分（如只说了时段没说哪天、或只说了哪天没说时段）：先记下已给的，再顺口把缺的那部分补问一句（如‘那大概哪天方便呢’）。\n"
    "- 若两部分都齐了：简短确认，告诉他后续若内部评估合适，会让招聘同事联系他敲定具体面试时间，保持手机畅通即可。\n"
    "注意：记下时间只是提前了解，不代表已确定面试、更不代表通过；别说‘恭喜/录用/定了/稳了’。一两句、自然口语。"
)
PROMPT_ANSWER = P(
    "候选人在反问问题（岗位/薪资/公司/地点/流程等）。用已知资料直接、坦诚地回答，不绕弯不打官腔；薪资可给区间。"
    "答完用一句话自然地把话题拉回到了解他、或他方便的面试时间上。一两句。"
)
PROMPT_SOOTHE = P(
    "候选人表达了顾虑/犹豫（如还在看别家、担心某点、暂时不太想动、问得比较谨慎）。先共情、理解他，"
    "用一句真诚的话轻轻回应他的顾虑（可结合岗位匹配点或 JD 信息，但不夸大、不强推、不纠缠），"
    "留个继续聊的余地或后续再联系的口子。一两句、别劝。"
)

# 生成内部纪要（回写人才库用，非发给候选人）——纯 Markdown
PROMPT_SUMMARY = (
    HEAD + CTX +
    "\n【任务】你现在不是和候选人说话，而是给招聘同事写一份本次电话沟通的【内部纪要】。"
    "根据上面的历史对话，用简洁 Markdown 输出，包含以下小节（聊到才写，没聊到写「未提及」）：\n"
    "**意向**：意向面试 / 待跟进 / 改约 之一\n"
    "**方便面试时段**：候选人提到的方便时间（口语原话即可）\n"
    "**深入了解**：分条列出 求职动机 / 核心经历与能力 / 求职进展(在面/offer) / 期望薪资 / 到岗时间 / 工作地点\n"
    "**顾虑/备注**：候选人的顾虑或需特别说明的点\n"
    "只输出 Markdown 纪要本身，不要任何寒暄、解释或对候选人的话，也不要用 ``` 代码块包裹。"
)

# ---------- 工作流图（主动投递·外呼场景；开场白=AI先开口，本图从候选人对「是否方便」的回应开始） ----------
NODES = [
    {"id": "start", "type": "start", "x": 80, "y": 460, "fields": {"input": "用户输入的内容", "welcome": WELCOME}},
    # 是否「对话结束」：结束时只走 生成纪要→回写(一次)，平时走正常意图流。回写不在每轮触发。
    {"id": "c_finalize", "type": "cond", "x": 240, "y": 460, "title": "对话是否结束", "fields": {
        "input": "用户输入的内容",
        "branches": [{"name": "对话结束(回写)", "conds": [{"op": "等于", "src": "session._finalize", "val": "true"}], "match": "所有"}],
    }},
    # 识别候选人本轮意图
    {"id": "intent", "type": "intent", "x": 520, "y": 460, "title": "识别候选人意图", "fields": {
        "input": "用户输入的内容", "model": "RunkeAI 4.0",
        "branches": [
            {"name": "现在不方便", "desc": "候选人表示此刻不方便通话：在忙/开会/在外面/在开车/不方便接听/等会儿再说。是【时机】问题，不是对机会本身的拒绝"},
            {"name": "主动反问", "desc": "候选人在向你打听岗位/薪资/公司/工作地点/面试流程等信息（通常带疑问语气或问号）"},
            {"name": "表达顾虑", "desc": "候选人对【这个机会本身】犹豫或有顾虑：还在看别家/手里有offer在考虑/担心某方面/觉得不太合适/对岗位消极。需要被安抚"},
            {"name": "回应面试时间", "desc": "候选人在就『面试时间』作答：给出了具体时间段、或回答方不方便、或表示愿不愿意来面试。仅当话题明确涉及面试时间安排时才归这类"},
            {"name": "配合沟通", "desc": "候选人正常配合：表示现在可以聊（如『可以/方便/你说/行/嗯』）、回答你提出的了解性问题或简短回应。默认归到这一类"},
        ],
    }},
    # 现在不方便 → 标记改约 + 致歉约下次
    {"id": "v_busy", "type": "variable", "x": 760, "y": 60, "title": "标记意向·改约", "fields": {"rows": [{"name": "session.interest", "value": "改约"}]}},
    {"id": "say_reschedule", "type": "llm", "x": 1080, "y": 60, "title": "致歉并约下次沟通时间", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_RESCHEDULE}},
    # 主动反问 → 答疑
    {"id": "say_answer", "type": "llm", "x": 760, "y": 240, "title": "解答候选人疑问", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_ANSWER}},
    # 表达顾虑 → 标记待跟进 + 安抚
    {"id": "v_concern", "type": "variable", "x": 760, "y": 420, "title": "标记意向·待跟进", "fields": {"rows": [{"name": "session.interest", "value": "待跟进"}]}},
    {"id": "say_soothe", "type": "llm", "x": 1080, "y": 420, "title": "回应顾虑并安抚", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_SOOTHE}},
    # 回应面试时间 → 标记意向面试 + 记录时间
    {"id": "v_time", "type": "variable", "x": 760, "y": 600, "title": "标记意向·可面试", "fields": {"rows": [{"name": "session.interest", "value": "意向面试"}]}},
    {"id": "say_time_log", "type": "llm", "x": 1080, "y": 600, "title": "记录时间并说明后续", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_TIME_LOG}},
    # 配合沟通 → 看当前阶段
    {"id": "c_phase", "type": "cond", "x": 760, "y": 860, "title": "当前所处阶段", "fields": {
        "input": "用户输入的内容",
        "branches": [{"name": "已进入约面试时间", "conds": [{"op": "等于", "src": "session.phase", "val": "timing"}], "match": "所有"}],
    }},
    {"id": "say_time_nudge", "type": "llm", "x": 1400, "y": 780, "title": "再次轻问方便时间", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_TIME_NUDGE}},
    {"id": "c_enough", "type": "cond", "x": 1400, "y": 1040, "title": "是否了解充分", "fields": {
        "input": "用户输入的内容",
        "branches": [{"name": "已了解满5轮", "conds": [{"op": "大于等于", "src": "session.gather_round", "val": "5"}], "match": "所有"}],
    }},
    {"id": "v_to_time", "type": "variable", "x": 1760, "y": 940, "title": "进入约面试时间阶段", "fields": {"rows": [{"name": "session.phase", "value": "timing"}]}},
    {"id": "say_ask_time", "type": "llm", "x": 2080, "y": 860, "title": "询问方便的面试时间", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_ASK_TIME}},
    {"id": "v_round", "type": "variable", "x": 1760, "y": 1140, "title": "了解轮次+1", "fields": {"rows": [{"name": "session.gather_round", "inc": "递增", "step": "1"}]}},
    {"id": "say_gather", "type": "llm", "x": 2080, "y": 1140, "title": "深入了解候选人", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_GATHER}},
    # 结论分支(意向面试/待跟进/改约)汇合：生成内部纪要 → 回写人才库 → 按意向出对应回复
    {"id": "gen_summary", "type": "llm", "x": 1120, "y": 300, "title": "生成沟通纪要(内部)", "fields": {"input": "用户输入的内容", "model": "RunkeAI 4.0", "prompt": PROMPT_SUMMARY}},
    {"id": "writeback", "type": "skill", "x": 1440, "y": 300, "title": "回写人才库(飞书)", "fields": {
        "skillId": "",  # 由 seed 创建技能后填入（引擎读 fields.skillId）
        "args": [{"name": "record_id", "value": "{{session.record_id}}"}, {"name": "notes", "value": "{{上一个节点的输出内容}}"}],
    }},
    {"id": "end", "type": "end", "x": 2480, "y": 460, "fields": {}},
]

EDGES = [
    {"from": "start", "to": "c_finalize"},
    {"from": "c_finalize", "to": "gen_summary", "port": 0},   # 对话结束 → 生成纪要→回写(一次)
    {"from": "c_finalize", "to": "intent", "port": 1},        # 默认：正常对话
    {"from": "gen_summary", "to": "writeback"},
    {"from": "writeback", "to": "end"},
    # 每轮只对话、不回写：各分支直接出回复
    {"from": "intent", "to": "v_busy", "port": 0},           # 现在不方便
    {"from": "v_busy", "to": "say_reschedule"},
    {"from": "say_reschedule", "to": "end"},
    {"from": "intent", "to": "say_answer", "port": 1},       # 主动反问
    {"from": "say_answer", "to": "end"},
    {"from": "intent", "to": "v_concern", "port": 2},        # 表达顾虑
    {"from": "v_concern", "to": "say_soothe"},
    {"from": "say_soothe", "to": "end"},
    {"from": "intent", "to": "v_time", "port": 3},           # 回应面试时间
    {"from": "v_time", "to": "say_time_log"},
    {"from": "say_time_log", "to": "end"},
    {"from": "intent", "to": "c_phase", "port": 4},          # 配合沟通
    {"from": "c_phase", "to": "say_time_nudge", "port": 0},  # 已在约时间阶段→再轻问时间
    {"from": "c_phase", "to": "c_enough", "port": 1},        # 默认：仍在了解阶段
    {"from": "c_enough", "to": "v_to_time", "port": 0},      # 了解充分→转约时间
    {"from": "v_to_time", "to": "say_ask_time"},
    {"from": "c_enough", "to": "v_round", "port": 1},        # 默认：继续了解
    {"from": "v_round", "to": "say_gather"},
    {"from": "say_gather", "to": "end"},
    {"from": "say_ask_time", "to": "end"},
    {"from": "say_time_nudge", "to": "end"},
]

GRAPH = {"nodes": NODES, "edges": EDGES}


# 飞书人才库（回写目标）：URL 公开标识；授权码从环境变量读，不入库到代码仓库
TALENT_URL = "https://my.feishu.cn/base/SqUhbeJqLa8FpKs9csXcqYtrnCh?table=tblyv0Nn1onXUUMT"
WRITEBACK_SKILL_NAME = "回写人才库(飞书)"


async def main() -> None:
    import os

    from app.models.skill import Skill

    token = os.environ.get("FEISHU_PERSONAL_TOKEN", "")
    async with SessionLocal() as s:
        uid = (await s.execute(select(User.id).where(User.email == "demo@runke.dev"))).scalar_one_or_none()
        if uid is None:
            print("缺少 demo 用户，请先 uv run python scripts/seed.py")
            return
        # 回写技能（飞书多维表格）：单字段 notes → AI沟通纪要(Markdown)。幂等：按名 upsert
        skill = (await s.execute(select(Skill).where(Skill.owner_id == uid, Skill.name == WRITEBACK_SKILL_NAME))).scalars().first()
        cfg = {"url": TALENT_URL, "personal_base_token": token, "fields": [{"arg": "notes", "field": "AI沟通纪要", "type": "text"}]}
        if skill is None:
            skill = Skill(owner_id=uid, name=WRITEBACK_SKILL_NAME, skill_type="bitable",
                          description="把本次电话沟通纪要回写到人才库候选人记录的「AI沟通纪要」字段",
                          config=cfg, inputs=[{"name": "record_id"}, {"name": "notes"}])
            s.add(skill)
        else:
            skill.config = cfg
        await s.flush()
        # 把技能 id 注入回写节点
        for n in NODES:
            if n["id"] == "writeback":
                n["fields"]["skillId"] = str(skill.id)

        old = (await s.execute(select(Bot).where(Bot.owner_id == uid, Bot.name == BOT_NAME))).scalars().all()
        for b in old:
            await s.execute(delete(Conversation).where(Conversation.bot_id == b.id))
            await s.delete(b)
        await s.flush()
        bot = Bot(
            owner_id=uid, name=BOT_NAME, bot_role="招聘顾问",
            description="对主动投递的候选人做深入了解，并了解其方便的面试时间（一期纯文字，模拟电话）",
            orchestration_type="workflow", workflow_definition=GRAPH,
            variables=VARIABLES, model="RunkeAI 4.0", welcome=WELCOME, published=True,
        )
        s.add(bot)
        await s.commit()
        print(f"created bot 「{BOT_NAME}」 id={bot.id}  nodes={len(NODES)} edges={len(EDGES)} vars={len(VARIABLES)}")
        print(f"writeback skill id={skill.id}  token={'已配置' if token else '未配置(设 FEISHU_PERSONAL_TOKEN 重跑)'}")


if __name__ == "__main__":
    asyncio.run(main())
