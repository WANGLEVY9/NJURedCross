export const ACTIVITY_FEEDBACK_TEMPLATES = {
  rating: {label:'简单评价', questions:['意见建议']},
  summary: {label:'简短总结', questions:['服务经历','感受','收获','建议']},
  ihl: {label:'IHL 专用表', questions:['印象最深的部分及原因','意义不大的部分及原因','最大收获并列三点所学','能否吸引同学兴趣与参与度','提高效果的建议']},
};

export const validFeedbackTemplate = key => typeof key==='string'&&Object.hasOwn(ACTIVITY_FEEDBACK_TEMPLATES,key);
