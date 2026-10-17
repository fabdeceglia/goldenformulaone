export interface Tab<T extends string> {
  id: T
  label: string
}

interface TabsProps<T extends string> {
  tabs: readonly Tab<T>[]
  active: T
  onChange: (id: T) => void
  ariaLabel?: string
  variant?: 'default' | 'compact'
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = 'Sections',
  variant = 'default',
}: TabsProps<T>) {
  return (
    <div
      className={`tabs${variant === 'compact' ? ' tabs--compact' : ''}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`panel-${tab.id}`}
          className={`tabs__button${tab.id === active ? ' tabs__button--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
