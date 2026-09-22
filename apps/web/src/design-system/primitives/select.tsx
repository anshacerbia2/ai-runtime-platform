import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../components/icon';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Listbox-pattern select built from scratch — no third-party primitive.
 *
 * Implements the WAI-ARIA "Select-Only Combobox" keyboard contract:
 * Enter/Space/Alt+Down open, Up/Down move the active option, Home/End jump,
 * printable characters type-ahead, Enter/Space commit, Escape cancels, Tab
 * commits and leaves. Focus stays on the trigger throughout and the active
 * option is advertised with aria-activedescendant, which is what lets a
 * screen reader follow the highlight without moving DOM focus into the list.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  id,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeAhead = useRef({ query: '', at: 0 });

  const selected = options.find((option) => option.value === value);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openAt = useCallback(() => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }, [options, value]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option) {
        onChange(option.value);
      }
      close();
    },
    [options, onChange, close],
  );

  // Pointer-down rather than click: a click listener would fire after the
  // trigger's own handler and immediately reopen a just-closed list.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the active option in view without scrolling the page around it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const node = listRef.current?.children[activeIndex];
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  function moveTo(index: number) {
    const last = options.length - 1;
    setActiveIndex(index < 0 ? 0 : index > last ? last : index);
  }

  function search(character: string) {
    const now = Date.now();
    // A pause resets the buffer, so "sc" finds "scribe" but a later "s"
    // starts a fresh search rather than extending a stale one.
    const query =
      now - typeAhead.current.at > 600
        ? character
        : typeAhead.current.query + character;
    typeAhead.current = { query, at: now };
    const found = options.findIndex((option) =>
      option.label.toLowerCase().startsWith(query.toLowerCase()),
    );
    if (found >= 0) {
      if (open) {
        setActiveIndex(found);
      } else {
        onChange(options[found]!.value);
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          openAt();
        } else {
          moveTo(activeIndex + 1);
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          openAt();
        } else {
          moveTo(activeIndex - 1);
        }
        return;
      case 'Home':
        if (open) {
          event.preventDefault();
          moveTo(0);
        }
        return;
      case 'End':
        if (open) {
          event.preventDefault();
          moveTo(options.length - 1);
        }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) {
          commit(activeIndex);
        } else {
          openAt();
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        return;
      case 'Tab':
        if (open) {
          commit(activeIndex);
        }
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          search(event.key);
        }
    }
  }

  return (
    <div className="ds-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="ds-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt())}
        onKeyDown={onKeyDown}
      >
        <span className="ds-select-value">{selected?.label ?? label}</span>
        <Icon name="chevron-down" className="ds-select-caret" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="ds-select-list"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                className={
                  index === activeIndex
                    ? 'ds-select-option is-active'
                    : 'ds-select-option'
                }
                // Mouse selection runs on pointer-down so the list cannot be
                // dismissed by the outside handler before the click lands.
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
                onPointerEnter={() => setActiveIndex(index)}
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <Icon name="check" className="ds-select-check" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
