import { expect, test } from 'vitest';
import { emptyProfile } from '../../packages/contracts/src';
import { fromForm, toForm } from '../../apps/web/src/lib/profile-form';
import { errorMessage } from '../../apps/web/src/lib/errors';
test('blank value mode is not explicit none; 200 Unicode code points remain valid', () => {
  const form = toForm(emptyProfile());
  form.backend = { mode: 'value', value: ' , ' };
  expect(() => fromForm(form)).toThrow('INVALID_PROFILE');
  form.backend = { mode: 'none', value: '' };
  form.project_name = { mode: 'value', value: '😀'.repeat(200) };
  expect(fromForm(form).backend).toEqual([]);
  expect(fromForm(form).project_name).toBe('😀'.repeat(200));
});

test('newline lists over 200 total characters save as separate deduplicated items', () => {
  const form = toForm(emptyProfile());
  const values = Array.from({ length: 20 }, (_, index) => `프로젝트 기능 ${index + 1} 확인하기`);
  form.features = { mode: 'value', value: [...values, values[0]!, `  ${values[1]}  `].join('\r\n') };
  expect(form.features.value.length).toBeGreaterThan(200);
  expect(fromForm(form).features).toEqual(values);
});

test('a long individual item explains the field and item length instead of the list total', () => {
  const form = toForm(emptyProfile());
  form.features = { mode: 'value', value: `로그인\n${'가'.repeat(201)}` };
  let message = '';
  try { fromForm(form); } catch (error) { message = errorMessage(error); }
  expect(message).toContain('기능'); expect(message).toContain('2번째'); expect(message).toContain('201자');
});

test('55 short features can save, and overflow reports the specific feature count', () => {
  const form = toForm(emptyProfile());
  form.features = { mode: 'value', value: Array.from({ length: 55 }, (_, index) => `기능 ${index}`).join('\n') };
  expect(fromForm(form).features).toHaveLength(55);
  form.features.value = Array.from({ length: 101 }, (_, index) => `기능 ${index}`).join('\n');
  let message = '';
  try { fromForm(form); } catch (error) { message = errorMessage(error); }
  expect(message).toContain('기능'); expect(message).toContain('101개'); expect(message).toContain('100개');
});
