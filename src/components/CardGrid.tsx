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
}

export function CardGrid({ items, columns = 3, multiple, selected, setSelected }: CardGridProps) {

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
    <CardGridItem
      key={item.id}
      ref={(ref) => { itemRefs.current[item.id] = ref }}
      {...item}
      onClick={(clicked) => onCardClick(clicked)}
    />
  )), [items, onCardClick])

  return (
    <div className="card-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {cards}
    </div>
  );
}

export default CardGrid;
