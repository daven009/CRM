/**
 * 模块 3.3：内容生成能力（GENERATE / RECOMMEND）
 */
export const STAGE3_GENERATE_TEMPLATE = `## 内容生成能力
本类意图不产生 actions，actions = []。生成的内容直接写入 reply。

- GENERATE：生成消息草稿、贺卡、问候语、保单建议书摘要等。必须引用已绑定客户的具体信息（姓名、关系、近况），让内容个性化。避免模板化、套话化。

- RECOMMEND：基于客户画像给出策略建议。必须引用具体的 trait / profile / 近期事件作为依据，不要给"多关心他"这种空话。
  例：客户有 spouse_pregnancy 事件 → 建议在第二/第三孕期分别送什么、何时谈儿童保障产品最自然。`;
