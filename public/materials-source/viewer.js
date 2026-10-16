const byId = id => document.getElementById(id);
let tables = [];
let start = 0;
let busy = false;
function state(message, error = false) {
  byId('status').textContent = message;
  byId('status').classList.toggle('error', error);
}
async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const phase = { authentication: '认证', metadata: '表结构读取', rows: '记录读取' }[data.phase];
    throw new Error(`${phase ? `${phase}失败：` : ''}${data.message || '读取失败'}`);
  }
  return data;
}
function setBusy(value) {
  busy = value;
  for (const id of ['refresh', 'tables', 'previous', 'next']) byId(id).disabled = value;
}
function cell(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
async function loadRows() {
  const table = tables.find(item => item.name === byId('tables').value);
  byId('records').replaceChildren(); byId('raw').textContent = ''; byId('count').textContent = '';
  byId('previous').disabled = true; byId('next').disabled = true;
  byId('page').textContent = ''; byId('missing').textContent = '';
  if (!table.exists) {
    byId('missing').textContent = '这张表在 API 返回的表结构中不存在，尚未创建或名称与项目配置不同。';
    return;
  }
  const data = await get(`/api/materials-source/rows?table=${encodeURIComponent(table.name)}&start=${start}`);
  const names = [...new Set([...table.columns.map(column => column.name), ...data.rows.flatMap(row => Object.keys(row))])];
  const head = document.createElement('thead'); const header = document.createElement('tr');
  for (const name of names) header.append(cell('th', name));
  head.append(header); const body = document.createElement('tbody');
  for (const row of data.rows) {
    const tr = document.createElement('tr');
    for (const name of names) {
      const value = row[name];
      tr.append(cell('td', value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)));
    }
    body.append(tr);
  }
  byId('records').append(head, body); byId('raw').textContent = JSON.stringify(data, null, 2);
  byId('count').textContent = `本页 ${data.rows.length} 条`; byId('page').textContent = `第 ${start / 100 + 1} 页`;
  byId('previous').disabled = start === 0; byId('next').disabled = data.rows.length < data.limit;
  if (!data.rows.length) byId('missing').textContent = '本页没有记录。';
}
async function run(reconnect = false) {
  if (busy) return;
  setBusy(true); byId('contents').hidden = true;
  state(reconnect ? '正在连接并读取表结构…' : '正在读取记录…');
  try {
    if (reconnect) {
      const data = await get('/api/materials-source/schema'); tables = data.tables; start = 0;
      byId('tables').replaceChildren(...tables.map(table => {
        const option = document.createElement('option'); option.value = table.name;
        option.textContent = table.name + (table.exists ? '' : '（未发现）'); return option;
      }));
    }
    // Release controls before updating paging availability; requests remain serialized by busy.
    for (const id of ['refresh', 'tables']) byId(id).disabled = false;
    await loadRows();
    state(`连接成功 · 数据读取于 ${new Date().toLocaleTimeString('zh-CN')} · 只读`);
    byId('contents').hidden = false;
  } catch (error) {
    state(`${error.message} 当前未展示数据。`, true);
  } finally { busy = false; byId('refresh').disabled = false; byId('tables').disabled = false; }
}
byId('refresh').addEventListener('click', () => run(true));
byId('tables').addEventListener('change', () => { start = 0; run(); });
byId('previous').addEventListener('click', () => { start = Math.max(0, start - 100); run(); });
byId('next').addEventListener('click', () => { start += 100; run(); });
run(true);
