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
  onEdit?: (item: Omit<CardGridItemProps, 'onClick'>, event: React.MouseEvent) => void;
  editingItemId?: string | number | null;
  onDelete?: (item: Omit<CardGridItemProps, 'onClick'>, event: React.MouseEvent) => void; // Keep for backward compatibility
  deletingItemId?: string | number | null;
}

export function CardGrid({ items, columns = 3, multiple, selected, setSelected, onEdit, editingItemId, onDelete, deletingItemId }: CardGridProps) {

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
      {onEdit && (item as any).uuid && (
        <button
          className="card-edit-button"
          onClick={(e) => onEdit(item, e)}
          disabled={editingItemId === item.id}
          title="Edit robot"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: '#ffc107',
            color: '#000',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            minWidth: '32px',
            minHeight: '32px',
            cursor: editingItemId === item.id ? 'wait' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            opacity: editingItemId === item.id ? 0.6 : 1,
            lineHeight: '1',
            padding: 0,
            margin: 0,
            textAlign: 'center',
            verticalAlign: 'middle',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          }}
          onMouseEnter={(e) => {
            if (editingItemId !== item.id) {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 193, 7, 0.5)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
          }}
        >
          {editingItemId === item.id ? '⏳' : <span style={{ transform: 'scaleX(-1)', display: 'inline-block' }}>✎</span>}
        </button>
      )}
      {onDelete && (item as any).uuid && !onEdit && (
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
