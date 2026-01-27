import { useState, forwardRef, useImperativeHandle } from 'react'
import './CardGridItem.css'

export interface CardGridItemProps {
  id: string | number;
  title: string;
  description?: string;
  location?: string; // Optional location to display on separate line
  imageUrl?: string;
  uuid?: string | undefined; // Optional UUID for identifying deletable items
  disabled?: boolean; // If true, robot is not accessible (grayed out, not clickable)
  hourlyRate?: string; // Formatted hourly rate (e.g., "$10.00/hour")
  onClick?: (item: Omit<CardGridItemProps, 'onClick' | 'disabled' | 'location' | 'hourlyRate'>) => void;
}

export interface CardGridItemHandle {
  setSelected: (selected: boolean) => void;
  isSelected: boolean;
}

const CardGridItem = forwardRef<CardGridItemHandle, CardGridItemProps>(function CardGridItem({id, title, description, location, imageUrl, uuid, disabled, hourlyRate, onClick}, ref) {
  const [isSelected, setIsSelected] = useState(false)

  useImperativeHandle(ref, () => ({
    setSelected: (selected: boolean) => setIsSelected(selected),
    isSelected,
  }), [isSelected])

  const handleClick = () => {
    if (disabled) {
      return; // Don't allow clicking disabled robots
    }
    if (onClick) {
      onClick({ id, title, description, imageUrl, uuid })
    }
  }

  return (
    <div
      key={id}
      className={`card-grid-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={_ => handleClick()}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-disabled={disabled}
      title={disabled ? 'You do not have access to this robot' : undefined}
    >
      {imageUrl && (
        <div className="card-grid-image">
          <img src={imageUrl} alt={title} />
        </div>
      )}
      <div className="card-grid-content">
        <h3>{title}</h3>
        {description && <p className="card-grid-description">{description}</p>}
        {hourlyRate && <p className="card-grid-price">{hourlyRate}</p>}
        {location && <p className="card-grid-location">{location}</p>}
      </div>
    </div>
  )
})

export default CardGridItem
