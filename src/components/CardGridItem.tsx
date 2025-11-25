import { useState, forwardRef, useImperativeHandle } from 'react'
import './CardGridItem.css'

export interface CardGridItemProps {
  id: string | number;
  title: string;
  description?: string;
  imageUrl?: string;
  uuid?: string | undefined; // Optional UUID for identifying deletable items
  onClick?: (item: Omit<CardGridItemProps, 'onClick'>) => void;
}

export interface CardGridItemHandle {
  setSelected: (selected: boolean) => void;
  isSelected: boolean;
}

const CardGridItem = forwardRef<CardGridItemHandle, CardGridItemProps>(function CardGridItem({id, title, description, imageUrl, onClick}, ref) {
  const [isSelected, setIsSelected] = useState(false)

  useImperativeHandle(ref, () => ({
    setSelected: (selected: boolean) => setIsSelected(selected),
    isSelected,
  }), [isSelected])

  const handleClick = () => {
    if (onClick) {
      onClick({ id, title, description, imageUrl })
    }
  }

  return (
    <div
      key={id}
      className={isSelected ? `card-grid-card selected` : `card-grid-card`}
      onClick={_ => handleClick()}
      tabIndex={0}
      role="button"
    >
      {imageUrl && (
        <div className="card-grid-image">
          <img src={imageUrl} alt={title} />
        </div>
      )}
      <div className="card-grid-content">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
    </div>
  )
})

export default CardGridItem
