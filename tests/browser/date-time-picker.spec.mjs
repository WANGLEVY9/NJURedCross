import { test, expect } from '@playwright/test';

async function mount(page, options = {}) {
  await page.goto('/login');
  await page.evaluate(async options => {
    const { field } = await import('/app/ui/primitives.js');
    const { enhanceDateTimeField } = await import('/app/ui/date-time-picker.js');
    const { bindKey } = await import('/app/core/keys.js');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/styles/date-time-picker.css';
    document.head.append(link);
    const form = document.createElement('form');
    form.dataset.surface = 'console';
    form.id = 'fixture';
    const node = field({ label: '活动开始时间', name: 'start', type: 'datetime-local', value: '2026-10-16T12:34:56', required: true, ...options });
    node.id = 'date-field';
    const original = node.control;
    enhanceDateTimeField(node);
    enhanceDateTimeField(node);
    form.dataset.preserved = String(node.control === original);
    form.dataset.inputs = '0';
    form.dataset.changes = '0';
    original.addEventListener('input', () => { form.dataset.inputs = String(Number(form.dataset.inputs) + 1); });
    original.addEventListener('change', () => { form.dataset.changes = String(Number(form.dataset.changes) + 1); });
    form.addEventListener('submit', event => { event.preventDefault(); form.dataset.submitted = 'true'; });
    const outside = document.createElement('button');
    outside.type = 'button';
    outside.textContent = '外部操作';
    const submit = document.createElement('button');
    submit.textContent = '提交';
    form.append(node, outside, submit);
    document.body.replaceChildren(form);
    bindKey('escape', () => { form.dataset.parentEscape = 'true'; }, { allowInInput: true });
  }, options);
}

const trigger = page => page.getByRole('button', { name: '选择日期与时间', exact: true });
const control = page => page.getByLabel('活动开始时间');
const focusedDay = page => page.locator('.date-time-picker__grid button[tabindex="0"]');

test('preserves labeled datetime input, native validation, form data and one enhancement', async ({ page }) => {
  await mount(page);
  await expect(page.locator('#fixture')).toHaveAttribute('data-preserved', 'true');
  await expect(trigger(page)).toHaveCount(1);
  await expect(control(page)).toHaveAttribute('type', 'datetime-local');
  await expect(control(page)).toHaveAttribute('step', '1');
  await control(page).fill('2026-11-02T01:02:03');
  await expect(control(page)).toHaveValue('2026-11-02T01:02:03');
  expect(await page.locator('#fixture').evaluate(form => new FormData(form).get('start'))).toBe('2026-11-02T01:02:03');
  await trigger(page).click();
  await expect(focusedDay(page)).toHaveAccessibleName('2026-11-02');
  await expect(page.getByRole('spinbutton', { name: '秒', exact: true })).toHaveValue('03');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.locator('#fixture').evaluate(form => form.checkValidity())).toBe(true);
  await control(page).fill('');
  expect(await control(page).evaluate(input => input.validity.valueMissing)).toBe(true);
});

test('cancel and Escape discard drafts, restore focus and isolate parent Escape', async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await page.getByRole('button', { name: '2026-10-20', exact: true }).click();
  await page.getByRole('spinbutton', { name: '秒', exact: true }).fill('59');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(control(page)).toHaveValue('2026-10-16T12:34:56');
  await expect(trigger(page)).toBeFocused();
  await trigger(page).click();
  await focusedDay(page).press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator('#fixture')).not.toHaveAttribute('data-parent-escape');
  await trigger(page).press('Escape');
  await expect(page.locator('#fixture')).toHaveAttribute('data-parent-escape', 'true');
  await expect(page.locator('#fixture')).toHaveAttribute('data-inputs', '0');
  await expect(page.locator('#fixture')).toHaveAttribute('data-changes', '0');
});

test('Apply commits seconds without timezone conversion and emits one input/change pair', async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await page.getByRole('button', { name: '2026-10-20', exact: true }).click();
  for (const [name, value] of [['时', '23'], ['分', '59'], ['秒', '07']]) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(value);
  }
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(control(page)).toHaveValue('2026-10-20T23:59:07');
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator('#fixture')).toHaveAttribute('data-inputs', '1');
  await expect(page.locator('#fixture')).toHaveAttribute('data-changes', '1');
  await expect(page.locator('#fixture')).not.toHaveAttribute('data-submitted');
});

test('calendar supports arrows, Monday Home/Sunday End, month and year paging', async ({ page }) => {
  await mount(page, { value: '2024-01-31T00:00:01' });
  await control(page).press('Alt+ArrowDown');
  for (const [key, value] of [
    ['PageDown', '2024-02-29'], ['ArrowRight', '2024-03-01'],
    ['ArrowDown', '2024-03-08'], ['ArrowUp', '2024-03-01'],
    ['Home', '2024-02-26'], ['End', '2024-03-03'],
    ['ArrowLeft', '2024-03-02'], ['PageUp', '2024-02-02'],
    ['Shift+PageDown', '2025-02-02'], ['Shift+PageUp', '2024-02-02'],
  ]) {
    await focusedDay(page).press(key);
    await expect(focusedDay(page)).toHaveAccessibleName(value);
    await expect(focusedDay(page)).toBeFocused();
  }
  await focusedDay(page).press('Escape');
  await expect(control(page)).toBeFocused();
});

test('rejects invalid time and min/max violations without mutating original value', async ({ page }) => {
  await mount(page, { min: '2026-10-16T12:34:00', max: '2026-10-16T12:35:00' });
  await trigger(page).click();
  const seconds = page.getByRole('spinbutton', { name: '秒', exact: true });
  for (const value of ['60', '-1', '1.5', '']) {
    await seconds.fill(value);
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.getByRole('alert').filter({ visible: true })).toContainText('请输入有效时间');
    await expect(control(page)).toHaveValue('2026-10-16T12:34:56');
  }
  await seconds.fill('59');
  await page.getByRole('spinbutton', { name: '分', exact: true }).fill('35');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('alert').filter({ visible: true })).toContainText('不在允许范围');
  await page.getByRole('spinbutton', { name: '分', exact: true }).fill('34');
  await seconds.press('Enter');
  await expect(control(page)).toHaveValue('2026-10-16T12:34:59');
  await expect(page.locator('#fixture')).not.toHaveAttribute('data-submitted');
});

test('Gregorian leap dates and four-digit year boundaries are retained', async ({ page }) => {
  await mount(page, { value: '0001-01-01T00:00:01' });
  await trigger(page).click();
  await expect(page.getByRole('button', { name: '上个月' })).toBeDisabled();
  await focusedDay(page).press('ArrowLeft');
  await expect(focusedDay(page)).toHaveAccessibleName('0001-01-01');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(control(page)).toHaveValue('0001-01-01T00:00:01');
  for (const [value, expected] of [['1900-01-31T00:00:01', '1900-02-28'], ['2000-01-31T00:00:01', '2000-02-29']]) {
    await control(page).fill(value);
    await trigger(page).click();
    await focusedDay(page).press('PageDown');
    await expect(focusedDay(page)).toHaveAccessibleName(expected);
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
  await control(page).fill('9999-12-31T23:59:59');
  await trigger(page).click();
  await expect(page.getByRole('button', { name: '下个月' })).toBeDisabled();
  await focusedDay(page).press('ArrowRight');
  await focusedDay(page).press('PageDown');
  await expect(focusedDay(page)).toHaveAccessibleName('9999-12-31');
});

test('disabled and readonly inputs cannot open or apply; dynamic disabling closes', async ({ page }) => {
  await mount(page, { disabled: true });
  await expect(trigger(page)).toBeDisabled();
  await control(page).evaluate(input => { input.disabled = false; input.readOnly = true; });
  await expect(trigger(page)).toBeDisabled();
  await control(page).evaluate(input => { input.readOnly = false; });
  await trigger(page).click();
  await control(page).evaluate(input => { input.disabled = true; });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(control(page)).toHaveValue('2026-10-16T12:34:56');
});

test('focus leaving cancels without stealing focus; disposal restores input and releases Escape', async ({ page }) => {
  await mount(page, { step: 60 });
  await trigger(page).click();
  await page.getByRole('button', { name: '外部操作' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: '外部操作' })).toBeFocused();
  await trigger(page).click();
  await page.locator('#date-field').evaluate(node => node.disposeDateTimePicker());
  await expect(trigger(page)).toHaveCount(0);
  await expect(control(page)).toHaveAttribute('step', '60');
  await expect(control(page)).toBeFocused();
  await control(page).press('Escape');
  await expect(page.locator('#fixture')).toHaveAttribute('data-parent-escape', 'true');
  await page.locator('#date-field').evaluate(async node => {
    const { enhanceDateTimeField } = await import('/app/ui/date-time-picker.js');
    enhanceDateTimeField(node);
  });
  await expect(trigger(page)).toHaveCount(1);
});

test('calendar fits a narrow field and has a single keyboard date stop', async ({ page }, testInfo) => {
  await mount(page);
  await page.locator('#fixture').evaluate(node => node.style.setProperty('width', '280px'));
  await trigger(page).click();
  await expect(page.getByRole('grid')).toHaveCount(1);
  await expect(focusedDay(page)).toHaveCount(1);
  expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.getByRole('dialog')).not.toHaveAttribute('aria-modal', 'true');
  await page.locator('#date-field').screenshot({ path: testInfo.outputPath('date-time-picker.png') });
  await page.getByRole('button', { name: '应用', exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: '外部操作' })).toBeFocused();
  await expect(page.getByRole('dialog')).toBeHidden();
});
