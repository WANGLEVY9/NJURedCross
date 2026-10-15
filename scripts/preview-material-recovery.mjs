import { Base } from 'seatable-api';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

const server = process.env.SEATABLE_SERVER_URL;
const token = process.env.SEATABLE_API_TOKEN;
const expectedUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();

if (!server || !token || !expectedUuid) {
  throw new Error('缺少业务服务器、Token 或业务 Base UUID 配置。');
}

installSeaTableTransport();

try {
  await withRequestBudget(async () => {
    const base = new Base({ server, APIToken: token });
    await base.auth();

    if (base.dtableUuid !== expectedUuid) {
      throw new Error('认证返回的 Base UUID 与配置不一致，停止检查。');
    }

    const metadata = await base.getMetadata();
    const names = ['物资管理', '工位物资表', '物资流水表'];

    const tables = names.map(name => {
      const table = metadata.tables?.find(item => item.name === name);
      return {
        name,
        exists: Boolean(table),
        columns: (table?.columns || []).map(column => ({
          name: column.name,
          type: column.type,
          options: column.type === 'single-select'
            ? (column.data?.options || []).map(option => option.name)
            : undefined,
        })),
      };
    });

    console.log(JSON.stringify({
      mode: 'read-only',
      baseUuidMatches: true,
      writes: 0,
      tables,
    }, null, 2));

    if (tables.some(table => !table.exists)) {
      process.exitCode = 1;
    }
  });
} catch {
  console.error(
    '表结构检查失败。请核对测试环境配置和网络；此脚本未执行写入。',
  );
  process.exitCode = 1;
}