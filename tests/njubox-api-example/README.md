# NJU Box 资料库 API 独立测试

本目录将一次已完成的真实资料库增删改查验证整理为可复用示例。它不依赖平台、SeaTable、npm 包或生产 .env，不接入现有网页。

## 准备配置

使用 Node.js 22.13+（推荐 24 LTS）。在自己的 NJU Box 测试资料库中，从“高级 → API Token”取得资料库级 Token，写测试需“可读写”。账户 Token 不适用于本示例。

在项目根目录执行：

```sh
cd tests/njubox-api-example
cp .env.example .env
```

编辑本目录的 .env：

```dotenv
NJUBOX_SERVER_URL=https://box.nju.edu.cn
NJUBOX_API_TOKEN=你自己的资料库API Token
NJUBOX_REPO_ID=你自己的测试资料库UUID
```

资料库 UUID 可以从浏览器地址 /library/<UUID>/... 中读取。不要复制其他开发者的真实凭据。本地 .env 已被仓库忽略；公开的 .env.example 只保留占位符。

## 运行

默认仅查：验证 Token 绑定的库 UUID 与配置一致，读取根目录条目数、权限，不输出素材文件名。

```sh
node --env-file=.env client.mjs
```

显式开启真实增删改查（只针对新建的临时测试目录）：

```sh
node --env-file=.env client.mjs --write
```

执行顺序：

1. 读取库信息和根目录，确认 UUID、rw 权限。
2. 新建随机 /_api_crud_test_<UUID> 目录。
3. 上传 probe.txt，下载后逐字核对第一版内容。
4. 覆盖更新同一个文件，再下载核对第二版内容。
5. 删除测试文件，确认目录为空，再删除临时目录。
6. 确认临时目录已消失，比对原有根目录条目的名称、ID、类型。

脚本没有修改已有文件、清空回收站、创建分享链接或修改平台配置的功能。文件只含合成测试文本。删除不等于抹除服务器历史记录。

网络中断、进程被强制关闭时不能保证清理成功。脚本会尽量清理；无法确认时输出临时目录路径。只检查该路径，不删除无关文件。若临时目录出现非预期条目，脚本拒绝删除整个目录。原条目对比仅覆盖根目录快照，不代表全库深层审计；他人同时操作也可能导致对比不同。

## 接口与鉴权

所有管理请求使用 Authorization: Bearer <Repo-Token>：

| 操作 | 接口 |
| --- | --- |
| 库信息 | GET /api/v2.1/via-repo-token/repo-info/ |
| 列目录 | GET /api/v2.1/via-repo-token/dir/?path=... |
| 建目录 | POST 同上，operation=mkdir |
| 上传地址 | GET /api/v2.1/via-repo-token/upload-link/?path=...&replace=0或1 |
| 上传或覆盖 | POST 返回的地址，multipart file、parent_dir、replace |
| 下载地址 | GET /api/v2.1/via-repo-token/download-link/?path=... |
| 删文件 | DELETE /api/v2.1/via-repo-token/file/?path=... |
| 删空目录 | DELETE /api/v2.1/via-repo-token/dir/?path=... |

上传/下载链接由服务端动态返回，不是另一项需要配置的长期 Token。本例不输出这些链接，只接受同一 HTTPS 域名，不跟随重定向；其他部署若返回独立文件服务域名，需要先明确审核域名再适配。

官方参考：[鉴权](https://seafile-api.readme.io/reference/authentication)、[资料库接口](https://cloud.seafile.com/published/web-api/v2.1/library-api-tokens.md)、[上传与覆盖](https://seafile-api.readme.io/reference/get_api-v2-1-via-repo-token-upload-link)。

## 自动化测试

在项目根目录运行：

```sh
node --test tests/njubox-api-example.test.mjs
```

自动化测试全部使用内存模拟，不读取 .env，不访问网络，不写真实业务库。已纳入项目默认 tests/*.test.mjs 测试范围。

## 本次真实验证记录

2026-10-10，对“南大红会图片素材库”进行独立测试：读取、新建目录、上传、覆盖、下载校验、删除文件与临时目录均返回 200；两版内容一致，清理后原有 32 个根目录条目的名称、ID、类型不变。

这是本次测试结果，不代表任意其他 Token、未来服务状态、大文件/图片预览或公网平台集成已验收。分享版脚本增加了默认只读、目标校验和异常清理保护；后续运行需使用各自测试配置。
