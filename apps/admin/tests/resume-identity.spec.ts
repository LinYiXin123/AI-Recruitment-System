import { expect, test } from '@playwright/test';
import { identifyResume } from '../src/lib/intake';

// 仅验证纯文本识别，不使用浏览器、网络或真实候选人资料。
const cases: {
  title: string;
  texts: string[];
  filename?: string;
  expected: { name: string[]; phone: string[]; email: string[] };
}[] = [
  {
    title: '空文本不产生建议',
    texts: ['', ' \n\t '],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '忽略页码和段落标记后识别明确中文标签',
    texts: [
      '[第 1 页]\n[段落 1] 姓名：测试甲\n[段落 2] 手机：13800000000\n[段落 3] 邮箱：test@example.com',
    ],
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '带标签的中文姓名合并字间空格并止于下一项',
    texts: ['姓名：欧阳 明\n性别：未说明', '姓 名：欧 阳 明 性别：未说明'],
    expected: { name: ['欧阳明'], phone: [], email: [] },
  },
  {
    title: '识别明确英文姓名及联系方式标签',
    texts: ['Name: Test Candidate\nPhone: 13800000000\nEmail: TEST@EXAMPLE.COM'],
    expected: { name: ['Test Candidate'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '全角标签数字和邮箱字符统一为半角',
    texts: [
      'Ｎａｍｅ：Ｔｅｓｔ　Ｃａｎｄｉｄａｔｅ\n手机：１３８００００００００\n邮箱：ｔｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ',
    ],
    expected: { name: ['Test Candidate'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '区号和3-4-4格式规范化后去重',
    texts: [
      '姓名：测试甲\n电话：13800000000\n手机：+86 138 0000 0000\n联系电话：0086 138-0000-0000\n备用电话：138-0000-0000\n邮箱：TEST@example.com\n邮箱：test@example.com',
    ],
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '多个不同号码和常用域名邮箱保留为多个候选',
    texts: [
      '姓名：测试甲\n手机：13800000000\n备用手机：13800000001\n邮箱：test@example.cn\n备用邮箱：test@example.edu.cn\n电子邮箱：test@example.io',
    ],
    expected: {
      name: ['测试甲'],
      phone: ['13800000000', '13800000001'],
      email: ['test@example.cn', 'test@example.edu.cn', 'test@example.io'],
    },
  },
  {
    title: '身份证和打码联系方式不能拼成有效号码',
    texts: [
      '姓名：测试甲\n身份证号：110000200001010000\n手机：138****0000\n邮箱：t***@example.com',
      '姓名：测试甲\n邮箱：a***b@example.com 或 test@example.c***om',
      '姓名：测试甲\n邮箱：test@example.com.c***om',
    ],
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '同行的推荐人证明人和紧急联系人均不作为本人建议',
    texts: ['推荐人', '证明人', '紧急联系人'].map(
      (label) => `姓名：测试甲\n${label}：测试乙 电话：13800000001 邮箱：reference@example.com`,
    ),
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '参考人后续块即使使用姓名电话标签也不作为本人建议',
    texts: ['推荐人', '证明人', '紧急联系人'].map(
      (label) =>
        `姓名：测试甲\n手机：13800000000\n邮箱：test@example.com\n\n${label}\n\n姓名：测试乙\n手机：13800000001\n邮箱：reference@example.com`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '首部姓名与求职意向性别或电话标签在同一行相邻时可识别',
    texts: ['求职意向：测试工程师', '性别：未说明', '电话：13800000000'].map(
      (label) => `测试甲 ${label}\n手机：13800000000`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: [] },
  },
  {
    title: '忽略PDF页码和空行后识别姓名与职位标题的分隔符',
    texts: ['|', '｜', '丨'].map(
      (separator) => `[第 1 页]\n\n测试甲 ${separator} AI 应用开发\n\n电话：13800000000`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: [] },
  },
  {
    title: '复姓和姓名字间空格规范化后识别职位标题',
    texts: ['欧阳 明 | 前端开发', '欧 阳 明｜前端开发'],
    expected: { name: ['欧阳明'], phone: [], email: [] },
  },
  {
    title: '保留中文姓名中的中点',
    texts: ['阿甲·测试 | 前端开发'],
    expected: { name: ['阿甲·测试'], phone: [], email: [] },
  },
  {
    title: '姓名和职位只用空格隔开时须有完整同名文件佐证',
    texts: ['测试甲 前端开发', '测试甲  AI 应用开发'],
    filename: '测试甲简历.pdf',
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '不把职位前缀截断当作姓名',
    texts: ['高级 Java 开发工程师', '软件 测试工程师'].map(
      (title) => `${title}\n手机：13800000000`,
    ),
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: '独立姓名紧邻手机号时可识别',
    texts: ['测试甲\n手机：13800000000', '手机：13800000000\n测试甲'],
    expected: { name: ['测试甲'], phone: ['13800000000'], email: [] },
  },
  {
    title: '独立姓名紧邻邮箱时可识别',
    texts: ['测试甲\n邮箱：test@example.com'],
    expected: { name: ['测试甲'], phone: [], email: ['test@example.com'] },
  },
  {
    title: '独立姓名紧邻学历或求职信息时可识别',
    texts: ['测试甲\n学历：本科', '测试甲\n求职意向：前端开发'],
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '正文独立姓名由完整同名文件名佐证',
    texts: ['测试甲'],
    filename: '测试甲简历.pdf',
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '文件名只有部分相同不能佐证正文姓名',
    texts: ['测试甲'],
    filename: '测试甲乙简历.pdf',
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '没有个人信息或文件名佐证时不猜独立姓名',
    texts: ['测试甲'],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '未标注的双词英文标题由同名文件佐证',
    texts: ['Test Candidate | Frontend Developer', 'Test Candidate'],
    filename: 'Test Candidate.pdf',
    expected: { name: ['Test Candidate'], phone: [], email: [] },
  },
  {
    title: '三词英文姓名由同名文件佐证',
    texts: ['Test Middle Candidate | Frontend Developer'],
    filename: 'Test Middle Candidate.pdf',
    expected: { name: ['Test Middle Candidate'], phone: [], email: [] },
  },
  {
    title: '四词英文姓名由同名文件佐证',
    texts: ['Test Middle Sample Candidate | Frontend Developer'],
    filename: 'Test Middle Sample Candidate.pdf',
    expected: { name: ['Test Middle Sample Candidate'], phone: [], email: [] },
  },
  {
    title: '未标注英文姓名缺少同名文件佐证时留空',
    texts: [
      'Test Candidate | Frontend Developer\nPhone: 13800000000',
      'Test Candidate\nPhone: 13800000000',
    ],
    filename: 'Different Candidate.pdf',
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: '只有文件名而没有正文姓名时不产生姓名建议',
    texts: ['', ' \n\t ', '教育经历\n虚构大学'],
    filename: '测试甲简历.pdf',
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '明确姓名标签优先于不同的标题姓名和文件名',
    texts: ['测试甲 | 前端开发\n姓名：测试乙'],
    filename: '测试甲简历.pdf',
    expected: { name: ['测试乙'], phone: [], email: [] },
  },
  {
    title: '头部出现两个不同姓名时保留候选供人工核对',
    texts: ['测试甲 | 前端开发\n测试乙 | 后端开发', '姓名：测试甲\n姓名：测试乙'],
    expected: { name: ['测试甲', '测试乙'], phone: [], email: [] },
  },
  {
    title: '无标签姓名仅从前三个有效头部行识别',
    texts: ['编号：demo-1\n状态：待核对\n日期：2026-10-08\n测试甲 | 前端开发'],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '普通短标题和文件名不推断为姓名',
    texts: ['个人简历\n产品经理\n测试甲_简历.pdf', '测试工程师\n个人介绍\n测试甲.docx'],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '职位学校和公司标题不因下一行有电话而被识别为姓名',
    texts: ['产品经理', '前端开发', '测试工程师', '虚构大学', '虚构公司'].map(
      (title) => `${title}\n电话：13800000000`,
    ),
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: 'Company Name 标签不作为候选人姓名',
    texts: ['Company Name: Fictional Company\nPhone: 13800000000'],
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: '不从包含手机号片段的长数字中截取号码',
    texts: [
      '姓名：测试甲\n编号：991380000000099',
      '姓名：测试甲\n编号：1380000000099',
      `姓名：测试甲\n${'x'.repeat(3981)} 1380000000099`,
    ],
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '教育工作项目经历区段之后的身份和通讯内容不参与识别',
    texts: ['教育经历', '工作经历', '项目经历'].map(
      (heading) =>
        `姓名：测试甲\n手机：13800000000\n邮箱：test@example.com\n${heading}\n姓名：测试乙\n电话：13800000001\n邮箱：project@example.com`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
];

test('简历身份建议只提取可核对的头部信息并规范化去重', async () => {
  for (const { title, texts, filename, expected } of cases) {
    await test.step(title, () => {
      for (const text of texts) expect(identifyResume(text, filename)).toEqual(expected);
    });
  }
});
