import {
  getActiveAgentStep,
} from '../../public/app/shared/agent-workflow.js';
import {
  AGENT_DRAFT_STEPS,
  normalizeAgentDraftCandidate,
} from '../../public/app/shared/agent-draft-candidate.js';
import {
  validateAgentRevisionFields,
} from '../../public/app/shared/agent-draft-revision.js';
import { generateMockConversation } from './conversation-mock.js';

const TEMPLATES = {
  activity: {
    brief: {
      title: '活动需求核对',
      items: [
        '明确活动目标、服务对象和预计人数。',
        '补充日期、时间、地点和负责人。',
        '确认预算、场地条件及需要的审批。',
      ],
    },
    plan: {
      title: '策划与分工草案',
      items: [
        '筹备：确认负责人、场地、活动内容和时间安排。',
        '宣传：准备报名通知和宣传稿，核对事实后提交审核。',
        '人员：设置志愿者岗位、名额和培训要求。',
        '现场：安排签到、服务引导、应急联系和结束清点。',
        '收尾：核对服务记录、归还物资并整理活动总结。',
      ],
    },
    resources: {
      title: '物资与准备事项',
      items: [
        '根据活动内容列出物资名称、数量、用途和保管人。',
        '查询库存后再确定借用数量；当前模拟结果未查询真实库存。',
        '提前确认场地、电源、网络、指示牌和现场动线。',
        '整理风险与应急联系方案，交由负责人核对。',
      ],
    },
    configuration: {
      title: '活动配置草稿核对',
      items: [
        '活动名称：[待确认]',
        '日期、时段、地点：[待确认]',
        '负责人及补充负责人：[待确认]',
        '岗位、推荐名额和报名上限：[待确认]',
        '服务、培训及交通时长：[待确认]',
        '工作内容和报名要求：[待确认]',
        '确认配置后才能通过业务工具创建活动草稿。',
      ],
    },
    review: {
      title: '筹备方案最终核对',
      items: [
        '核对策划、分工、场地和物资安排是否完整。',
        '核对活动配置与宣传材料中的日期、地点和名额是否一致。',
        '列出仍缺少的信息和待完成的审批。',
        '本流程只准备方案，尚未创建、审批或发布真实活动。',
      ],
    },
  },
  writing: {
    brief: {
      title: '宣传需求核对',
      items: [
        '明确稿件用途：预告、招募、回顾或人物介绍。',
        '明确读者、语气、篇幅和预计发布时间。',
        '补充可引用的活动资料、照片和已确认数据。',
      ],
    },
    outline: {
      title: '标题与提纲草案',
      items: [
        '标题方向一：突出活动主题与读者能够获得的体验。',
        '标题方向二：突出志愿服务故事与实际行动。',
        '导语：用简短场景引入主题。',
        '主体：活动内容、参与方式或经过核实的成果。',
        '结尾：报名入口、后续安排或致谢。',
      ],
    },
    draft: {
      title: '推文正文示例',
      items: [
        '【标题】[活动名称]：让善意在行动中发生',
        '【导语】围绕[活动主题]，我们准备开展[已确认的活动内容]，邀请你一起参与。',
        '【活动介绍】[补充活动目标、具体安排与参与者能够获得的体验。]',
        '【参与信息】时间：[待确认]；地点：[待确认]；报名方式：[待确认]。',
        '【结尾】欢迎关注后续通知，一起把关怀落实为行动。',
        '方括号内的信息必须补充核实；当前内容是模拟模板。',
      ],
    },
    review: {
      title: '事实与文案核对',
      items: [
        '逐项核对日期、地点、人数、报名入口和负责人。',
        '删除尚未核实的成果描述，保留必要的待补信息。',
        '检查署名、照片授权和个人信息。',
        '调整重复表达、长段落和标题与正文不一致的问题。',
        '草稿准备完成后仍需按宣传审核流程处理。',
      ],
    },
  },
  design: {
    brief: {
      title: '视觉需求核对',
      items: [
        '明确用途、发布渠道、阅读设备和尺寸要求。',
        '确认已有品牌色、标志和可使用的图片。',
        '选择整体风格：简洁、温暖、纪实或活泼。',
      ],
    },
    layout: {
      title: '配色与版式建议',
      items: [
        '主色建议：沉稳红色 #8F3E50，少量用于标题和重点。',
        '背景建议：暖白色 #FAF7F3，正文使用深灰 #292524。',
        '建立标题、导语、小标题、正文和图注的层级。',
        '增加段落与图片区块之间的留白，避免大段密集文字。',
        '状态和重点同时使用文字说明，不能只靠颜色区分。',
      ],
    },
    preview: {
      title: '排版预览方案',
      items: [
        '顶部：封面占位、主标题和简短导语。',
        '主体：分段正文，每个主题配一个小标题。',
        '图片：按叙事顺序排列，并附简短图注。',
        '底部：时间地点或报名入口、署名与必要说明。',
        '当前仅生成文字方案，未分析图片，也未生成图片素材。',
      ],
    },
    review: {
      title: '阅读体验核对',
      items: [
        '在手机宽度下检查字号、换行和图片裁切。',
        '检查文字对比度、标题长度和段落密度。',
        '核对封面、正文与图片表达是否一致。',
        '确认图片和标志的使用授权后再进入正式审核。',
      ],
    },
  },
};

export function createMockAgentModel() {
  return {
    provider: 'mock',

    async generate({ task, instruction = '' }) {
      if (task?.taskType === 'conversation') {
        return generateMockConversation({ task, instruction });
      }

      const step = getActiveAgentStep(task);
      if (!step) throw new Error('当前任务没有待生成的步骤');
      if (typeof instruction !== 'string' || instruction.length > 2000) {
        throw new Error('修改要求格式不正确或过长');
      }

      const template = TEMPLATES[task.mode]?.[step.id];
      if (!template) throw new Error('当前步骤没有模拟模板');
      let draft;

      if (step.id === AGENT_DRAFT_STEPS[task.mode]) {
        const examples = {
          activity: {
            name: '[待确认] 活动名称',
            content: '[待确认] 请补充真实活动内容',
            work: '[待确认] 请补充岗位工作',
          },
          writing: {
            title: '[待确认] 推文标题',
            body: template.items.join('\n\n'),
            sourceNotes: '模拟模板，所有活动事实和素材授权需人工核对。',
          },
          design: {
            title: '模拟美编方案',
            headline: '[待确认] 图文标题',
            body: '[待确认] 请填写真实图文正文。',
            imageNotes: template.items.join('\n\n'),
            reviewNotes: '模拟方案，素材授权和实际呈现需人工核对。',
          },
        };

        draft = normalizeAgentDraftCandidate(task.mode, examples[task.mode]);
      }

      if (task.draftRevision) {
        const selected = validateAgentRevisionFields(
          task.mode,
          task.draftRevision.fields,
        );

        draft = normalizeAgentDraftCandidate(
          task.mode,
          step.output?.draft,
        );

        // 只演示标题类字段变化，不猜测数字、日期或其他事实。
        for (const name of selected) {
          if (!['name', 'title', 'headline'].includes(name)) continue;

          const suffix = '（模拟修改）';
          const maximum = name === 'name' ? 500 : 100;

          draft[name] =
            String(draft[name]).slice(0, maximum - suffix.length) + suffix;
        }
      }

      return {
        provider: 'mock',
        simulated: true,
        output: {
          title: template.title,
          summary: `模拟方案，需求摘要：${task.brief.slice(0, 500)}`,
          ...(draft ? { draft } : {}),
          items: [
            ...template.items,
            ...(instruction.trim()
              ? [`本轮补充要求：${instruction.trim()}`]
              : []),
          ],
        },
      };
    },
  };
}