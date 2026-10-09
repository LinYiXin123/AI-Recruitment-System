import Select from '@douyinfe/semi-ui/lib/es/select';
import type * as React from 'react';
import { Children, isValidElement, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type NativeSelectProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  defaultValue?: string | number;
  disabled?: boolean;
  filter?: boolean;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler;
  onChange?: (event: { target: { value: string } }) => void;
  onFocus?: React.FocusEventHandler;
  required?: boolean;
  size?: 'sm' | 'default';
  value?: string | number;
  children?: React.ReactNode;
};

function NativeSelect({
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  children,
  className,
  defaultValue,
  disabled,
  filter,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  required,
  size = 'default',
  value,
}: NativeSelectProps) {
  const selectRef = useRef<Select>(null);
  const [internalValue, setInternalValue] = useState<string | number>(value ?? defaultValue ?? '');
  const [invalid, setInvalid] = useState(false);
  const selectedValue = value ?? internalValue;

  return (
    <>
      <Select
        ref={selectRef}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-required={required || undefined}
        className={cn('native-select', className)}
        clickToHide
        motion={false}
        disabled={disabled}
        filter={filter}
        searchPosition={filter ? 'dropdown' : undefined}
        searchPlaceholder="搜索选项"
        dropdownClassName="candidate-select-dropdown"
        id={id}
        onBlur={onBlur}
        onChange={(nextValue) => {
          const next =
            typeof nextValue === 'string' || typeof nextValue === 'number' ? nextValue : '';
          if (value === undefined) setInternalValue(next);
          setInvalid(false);
          onChange?.({ target: { value: String(next) } });
        }}
        onFocus={onFocus}
        size={size === 'sm' ? 'small' : 'default'}
        value={String(selectedValue)}
      >
        {toSemiOptions(children)}
      </Select>
      <select
        aria-hidden="true"
        className="native-select-proxy"
        disabled={disabled}
        name={name}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          selectRef.current?.focus();
        }}
        required={required}
        tabIndex={-1}
        value={String(selectedValue)}
        onChange={() => undefined}
      >
        {children}
      </select>
    </>
  );
}

function toSemiOptions(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;

    if (child.type === NativeSelectOption) {
      const option = child.props as React.ComponentProps<'option'>;
      return (
        <Select.Option
          key={child.key}
          className={option.className}
          disabled={option.disabled}
          label={option.label ?? option.children}
          value={String(option.value ?? option.children ?? '')}
        >
          {option.children}
        </Select.Option>
      );
    }

    if (child.type === NativeSelectOptGroup) {
      const group = child.props as React.ComponentProps<'optgroup'>;
      return (
        <Select.OptGroup key={child.key} label={group.label}>
          {toSemiOptions(group.children)}
        </Select.OptGroup>
      );
    }

    return child;
  });
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  );
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
