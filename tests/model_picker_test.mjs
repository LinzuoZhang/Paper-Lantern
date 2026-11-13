import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class ClassList {
  constructor(element) { this.element = element; }
  values() { return new Set(this.element.className.split(/\s+/).filter(Boolean)); }
  write(values) { this.element.className = [...values].join(' '); }
  add(name) { const values = this.values(); values.add(name); this.write(values); }
  remove(name) { const values = this.values(); values.delete(name); this.write(values); }
  toggle(name, force) { const values = this.values(); const on = force === undefined ? !values.has(name) : Boolean(force);
    on ? values.add(name) : values.delete(name); this.write(values); }
  contains(name) { return this.values().has(name); }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.className = ''; this.children = []; this.parentNode = null;
    this.attributes = {}; this.handlers = {}; this.style = {}; this.classList = new ClassList(this);
    this.hidden = false; this.disabled = false; this.value = ''; this.ownText = ''; this.offsetHeight = 200;
  }
  get textContent() { return this.ownText || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  insertBefore(node, reference) { node.parentNode = this;
    const index = this.children.indexOf(reference); this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  removeEventListener(type, handler) { this.handlers[type] = (this.handlers[type] || []).filter(entry => entry !== handler); }
  dispatch(type, values = {}) { return (this.handlers[type] || []).map(handler => handler({ target: this,
    preventDefault() {}, stopPropagation() {}, ...values })); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector === child.tagName || selector === `.${child.className}`) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  getBoundingClientRect() { return { top: 700, bottom: 730, left: 100, right: 340, width: 240, height: 30 }; }
}

const documentNode = {
  body: new Element('body'),
  createElement: tagName => new Element(tagName),
  defaultView: { innerWidth: 900, innerHeight: 850, requestAnimationFrame: callback => callback(),
    addEventListener() {}, removeEventListener() {} },
  handlers: {},
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); },
  removeEventListener(type, handler) { this.handlers[type] = (this.handlers[type] || []).filter(entry => entry !== handler); },
  dispatch(type, values = {}) { return (this.handlers[type] || []).map(handler => handler({ target: new Element('body'),
    preventDefault() {}, stopPropagation() {}, ...values })); },
};

const source = await readFile(new URL('../assets/js/components/discussion_composer.js', import.meta.url), 'utf8');
const { createModelPicker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function mount() {
  const container = new Element('div');
  const select = new Element('select');
  select.className = 'discussion-model-select';
  select.setAttribute('aria-label', '讨论模型');
  const placeholder = new Element('option'); placeholder.textContent = '讨论模型';
  select.append(placeholder);
  container.append(select);
  const selected = [];
  const picker = createModelPicker(select, documentNode, id => selected.push(id));
  const trigger = container.children[0].children[0];
  return { container, select, picker, trigger, selected };
}
const profiles = count => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, label: `model-${index}` }));
const menuOf = () => documentNode.body.children.at(-1);
const options = menu => menu.querySelector('.model-picker-list').children.filter(child => child.getAttribute('role') === 'option');

// Empty and single-model states.
{
  const { select, picker, trigger } = mount();
  assert.equal(trigger.textContent, '讨论模型');
  assert.equal(trigger.disabled, true);
  assert.equal(select.hidden, true);
  picker.setOptions([], '', { ready: true });
  assert.equal(trigger.textContent, '暂无可用模型');
  assert.equal(trigger.disabled, true);
  picker.setOptions(profiles(1), 'p0', { ready: true });
  assert.equal(trigger.textContent, 'model-0');
  assert.equal(trigger.disabled, false);
}

// Five models: no search. Twenty models: search filters case-insensitively.
{
  const { picker, trigger } = mount();
  picker.setOptions(profiles(5), 'p0', { ready: true });
  trigger.dispatch('click');
  assert.equal(menuOf().querySelector('.model-picker-search'), null);
  assert.equal(options(menuOf()).length, 5);
  menuOf().remove();
  documentNode.dispatch('keydown', { key: 'Escape' });
  assert.equal(documentNode.body.children.length, 0);
  picker.setOptions(profiles(20), 'p0', { ready: true });
  trigger.dispatch('click');
  const menu = menuOf();
  const search = menu.querySelector('.model-picker-search').children[0];
  assert.ok(search);
  search.value = 'MODEL-1'; search.dispatch('input');
  assert.deepEqual(options(menu).map(option => option.title), ['model-1', 'model-10', 'model-11', 'model-12', 'model-13',
    'model-14', 'model-15', 'model-16', 'model-17', 'model-18', 'model-19']);
  search.value = '不存在'; search.dispatch('input');
  assert.equal(menu.querySelector('.model-picker-list').children[0].textContent, '没有找到匹配的模型');
  search.value = ''; search.dispatch('input');
  assert.equal(options(menu).length, 20);
  documentNode.dispatch('keydown', { key: 'Escape' });
}

// Keyboard selection, duplicate labels keyed by id, and outside/Escape closing.
{
  const { picker, trigger, selected, select } = mount();
  picker.setOptions([{ id: 'same-a', label: '同名模型' }, { id: 'same-b', label: '同名模型' }], 'same-a', { ready: true });
  trigger.dispatch('click');
  const menu = menuOf();
  assert.equal(options(menu).length, 2);
  menu.dispatch('keydown', { key: 'ArrowDown' });
  menu.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(selected, ['same-b']);
  assert.equal(select.value, ''); // The owner updates the native select before saving.
  assert.equal(documentNode.body.children.length, 0);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.dispatch('click');
  documentNode.dispatch('pointerdown', { target: new Element('main') });
  assert.equal(documentNode.body.children.length, 0);

  trigger.dispatch('click');
  documentNode.dispatch('keydown', { key: 'Escape' });
  assert.equal(documentNode.body.children.length, 0);
  assert.equal(trigger.focused, true);
}

// Option clicks keep the documented selection callback and re-render on updates.
{
  const { picker, trigger, selected } = mount();
  picker.setOptions(profiles(3), 'p0', { ready: true });
  trigger.dispatch('click');
  options(menuOf())[2].dispatch('click');
  assert.deepEqual(selected, ['p2']);
  assert.equal(trigger.textContent, 'model-2');
  trigger.dispatch('click');
  picker.setOptions([{ id: 'p0', label: '重命名' }, { id: 'p1', label: 'model-1' }], 'p0', { ready: true });
  assert.equal(trigger.textContent, '重命名');
  assert.deepEqual(options(menuOf()).map(option => option.title), ['重命名', 'model-1']);
  picker.setSelected('p0');
  assert.equal(trigger.textContent, '重命名');
  picker.setDisabled(true);
  assert.equal(trigger.disabled, true);
  assert.equal(documentNode.body.children.length, 0);
  picker.setOptions([], '', { ready: true });
  assert.equal(trigger.textContent, '暂无可用模型');
  assert.equal(trigger.disabled, true);
}

console.log('Model picker passed: empty/single/five/twenty models, search threshold, fuzzy filter, keyboard selection, duplicate labels, dynamic updates, outside/Escape closing and disabled states.');
