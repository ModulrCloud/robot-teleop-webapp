import { useMemo, useRef, useCallback } from "react";
import CardGridItem, {type CardGridItemProps} from "./CardGridItem";
import type { CardGridItemHandle } from "./CardGridItem";
import "./CardGrid.css";

interface CardGridProps {
  items: Omit<CardGridItemProps, 'onClick'>[];
  columns?: number;
  multiple: boolean;
  selected: Array<Omit<CardGridItemProps, 'onClick'>>;
  setSelected: (selected: Array<Omit<CardGridItemProps, 'onClick'>>) => void;
  onDelete?: (item: Omit<CardGridItemProps, 'onClick'>, event: React.MouseEvent) => void;
  deletingItemId?: string | number | null;
}

export function CardGrid({ items, columns = 3, multiple, selected, setSelected, onDelete, deletingItemId }: CardGridProps) {

  const itemRefs = useRef<Record<string | number, CardGridItemHandle | null>>({})

  const onCardClick = useCallback((item: Omit<CardGridItemProps, 'onClick'>) => {
    const clickedRef = itemRefs.current[item.id]

    if (!multiple) {
      Object.values(itemRefs.current).forEach(ref => ref?.setSelected(false))
      clickedRef?.setSelected(true)
      setSelected([item])
      return
    }

    const isAlreadySelected = selected.some(s => s.id === item.id)
    if (isAlreadySelected) {
      clickedRef?.setSelected(false)
      setSelected(selected.filter(s => s.id !== item.id))
    } else {
      clickedRef?.setSelected(true)
      setSelected([...selected, item])
    }
  }, [multiple, selected, setSelected])

  const cards = useMemo(() => items.map(item => (
    <div key={item.id} style={{ position: 'relative' }}>
      <CardGridItem
        ref={(ref) => { itemRefs.current[item.id] = ref }}
        {...item}
        onClick={(clicked) => onCardClick(clicked)}
      />
      {onDelete && (item as any).uuid && (
        <button
          className="card-delete-button"
          onClick={(e) => onDelete(item, e)}
          disabled={deletingItemId === item.id}
          title="Delete robot"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(220, 38, 38, 0.9)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            minWidth: '28px',
            minHeight: '28px',
            cursor: deletingItemId === item.id ? 'wait' : 'pointer',
            fontSize: '20px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            opacity: deletingItemId === item.id ? 0.6 : 1,
            lineHeight: '1',
            padding: 0,
            margin: 0,
            textAlign: 'center',
            verticalAlign: 'middle',
          }}
        >
          {deletingItemId === item.id ? '⏳' : '✕'}
        </button>
      )}
    </div>
  )), [items, onCardClick, onDelete, deletingItemId])

  return (
    <div className="card-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {cards}
    </div>
  );
}

export default CardGrid;
