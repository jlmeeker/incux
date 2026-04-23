import { createSignal, createMemo, For, Show, onCleanup, onMount } from 'solid-js';

export interface ComboOption {
  value: string;      // alias string sent to Incus
  label: string;      // primary display text
  sub?: string;       // secondary/dim text
  remote?: {          // present for non-local images
    server: string;
    protocol: 'simplestreams' | 'incus';
  };
}

interface ComboboxProps {
  options: ComboOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function Combobox(props: ComboboxProps) {
  const [query,   setQuery]   = createSignal('');
  const [open,    setOpen]    = createSignal(false);
  const [focused, setFocused] = createSignal(-1); // keyboard cursor index
  let inputRef!: HTMLInputElement;
  let listRef!: HTMLUListElement;

  // Text shown in the input: if the current value matches an option, show its
  // label; otherwise show the raw value (user typed something custom).
  const displayValue = () => {
    const match = props.options.find(o => o.value === props.value);
    return match ? match.label : props.value;
  };

  // The live text in the input — either the display value (when closed/selected)
  // or the current query (when filtering).
  const [inputText, setInputText] = createSignal('');

  // Sync inputText when value changes externally
  const syncInput = () => setInputText(displayValue());

  // Filtered options
  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q) return props.options;
    return props.options.filter(o =>
      o.value.toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (o.sub ?? '').toLowerCase().includes(q)
    );
  });

  function openList() {
    setQuery('');
    setFocused(-1);
    setOpen(true);
  }

  // Track the committed value separately from the display text.
  // This prevents closeList from overwriting a properly-selected value with its label.
  let committedValue = () => props.value;

  function closeList() {
    setOpen(false);
    setFocused(-1);
    // If the user typed something that doesn't match any option label AND doesn't
    // match the current committed value's label, treat it as a free-form value.
    const raw = inputText().trim();
    const committedLabel = props.options.find(o => o.value === committedValue())?.label ?? committedValue();
    if (raw && raw !== committedLabel) {
      // Check if raw exactly matches an option label — if so use its value
      const exact = props.options.find(o => o.label === raw);
      props.onChange(exact ? exact.value : raw);
    }
    syncInput();
  }

  function select(opt: ComboOption) {
    props.onChange(opt.value);
    setInputText(opt.label);
    setOpen(false);
    setFocused(-1);
  }

  function onInput(e: InputEvent) {
    const v = (e.currentTarget as HTMLInputElement).value;
    setInputText(v);
    setQuery(v);
    // Immediately surface as custom value so parent sees typing
    props.onChange(v);
    setOpen(true);
    setFocused(-1);
  }

  function onKeyDown(e: KeyboardEvent) {
    const opts = filtered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open()) { openList(); return; }
      setFocused(f => Math.min(f + 1, opts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocused(f => Math.max(f - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open() && focused() >= 0 && opts[focused()]) {
        select(opts[focused()]);
      } else {
        closeList();
      }
    } else if (e.key === 'Escape') {
      closeList();
    } else {
      if (!open()) openList();
    }
  }

  // Close on outside click
  function onDocClick(e: MouseEvent) {
    const target = e.target as Node;
    if (!inputRef.parentElement?.contains(target)) closeList();
  }
  onMount(() => document.addEventListener('mousedown', onDocClick));
  onCleanup(() => document.removeEventListener('mousedown', onDocClick));

  // Scroll focused item into view
  const scrollToFocused = (i: number) => {
    const item = listRef?.children[i] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div class="combobox-wrap">
      <div class="combobox-input-row">
        <input
          ref={inputRef}
          class="form-input"
          type="text"
          autocomplete="off"
          spellcheck={false}
          placeholder={props.loading ? 'Loading…' : (props.placeholder ?? 'Type or select…')}
          disabled={props.disabled || props.loading}
          value={open() ? inputText() : displayValue()}
          onFocus={() => { syncInput(); openList(); }}
          onBlur={() => setTimeout(closeList, 150)}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
        <Show when={props.value && !props.disabled}>
          <button
            type="button"
            class="combobox-clear"
            tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); props.onChange(''); setInputText(''); setQuery(''); }}
          >✕</button>
        </Show>
        <span class="combobox-chevron" aria-hidden>▾</span>
      </div>

      <Show when={open() && !props.disabled && !props.loading}>
        <ul class="combobox-list" ref={listRef!}>
          <Show when={filtered().length === 0}>
            <li class="combobox-empty">
              {inputText().trim()
                ? <>Use <strong>"{inputText().trim()}"</strong> as custom value — press Enter or click away</>
                : 'No options'}
            </li>
          </Show>
          <For each={filtered()}>
            {(opt, i) => (
              <li
                class={`combobox-option${focused() === i() ? ' focused' : ''}`}
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                onMouseEnter={() => { setFocused(i()); scrollToFocused(i()); }}
              >
                <span class="combobox-opt-label">{opt.label}</span>
                <Show when={opt.sub}>
                  <span class="combobox-opt-sub">{opt.sub}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
