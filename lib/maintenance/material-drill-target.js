export function assertMaterialDrillTarget({
  expectedUuid,
  configuredUuid,
  actualUuid,
  nodeEnv,
}) {
  if (nodeEnv === 'production') {
    throw new Error('故障演练不能在 production 模式下运行。');
  }

  const values = [expectedUuid, configuredUuid, actualUuid];
  if (values.some(value =>
    typeof value !== 'string' || !value.trim(),
  )) {
    throw new Error('必须明确指定测试 Base UUID。');
  }

  const [expected, configured, actual] = values.map(value => value.trim());
  if (expected !== configured || expected !== actual) {
    throw new Error('测试 Base UUID 不一致，禁止演练写入。');
  }

  return expected;
}